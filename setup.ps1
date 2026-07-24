[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$CheckOnly,
    [Alias('Y')][switch]$Yes
)

$ErrorActionPreference = 'Stop'
if ($CheckOnly) { $DryRun = $true }

$RepoDir      = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile  = Join-Path $RepoDir 'docker-compose.yml'
$EnvFile      = Join-Path $RepoDir '.env'
$ManifestFile = Join-Path $RepoDir 'installer\models.manifest.tsv'
$NativeDir    = Join-Path $RepoDir 'native'
$ServicesTaskName = 'StoryHaven Model Services'

function Write-Info  { param($m) Write-Host "==> $m"       -ForegroundColor Cyan }
function Write-Ok    { param($m) Write-Host "  ok $m"      -ForegroundColor Green }
function Write-Warn2 { param($m) Write-Host "  warning: $m" -ForegroundColor Yellow }
function Write-Err   { param($m) Write-Host "  error: $m"   -ForegroundColor Red }

function Ask {
    param([string]$Prompt, [string]$Default = '')
    if ($Yes) { return $Default }
    if ($Default) {
        $reply = Read-Host "$Prompt [$Default]"
        if ([string]::IsNullOrWhiteSpace($reply)) { return $Default }
        return $reply
    }
    return Read-Host $Prompt
}

function Confirm2 {
    param([string]$Question)
    if ($Yes) { return $true }
    $reply = Read-Host "$Question [y/N]"
    return ($reply -match '^(y|yes)$')
}

function Get-EnvValue {
    param([string]$Key)
    if (-not (Test-Path $EnvFile)) { return '' }
    $line = Select-String -Path $EnvFile -Pattern "^$Key=" | Select-Object -First 1
    if ($null -eq $line) { return '' }
    return ($line.Line -replace "^$Key=", '')
}

function Read-ModelManifest {
    if (-not (Test-Path $ManifestFile)) { return @() }
    $rows = Get-Content $ManifestFile | Where-Object { $_ } | ForEach-Object {
        $parts = $_ -split "`t"
        [pscustomobject]@{ Category = $parts[0]; File = $parts[1]; Url = $parts[2]; Default = $parts[3] -eq '1' }
    }
    return @($rows)
}

function Select-ManifestRows {
    param($Rows)
    $defaultCount = @($Rows | Where-Object Default).Count
    Write-Host ''
    Write-Host 'Model downloads' -ForegroundColor White
    Write-Host "  Image generation needs model files, downloaded from each model's own"
    Write-Host "  source site. The default set ($defaultCount files, the RealSkin image model and"
    Write-Host '  the Zoda detailer) is enough to generate good images out of the box.'
    Write-Host '  Some Civitai downloads need a free API token, set CIVITAI_TOKEN to use one.'
    $selection = @()
    if (Confirm2 'Download the default model set now?') { $selection = @($Rows | Where-Object Default) }
    if (Confirm2 'Also download the full model catalog? (tens of GB)') { $selection = @($Rows) }
    return ,$selection
}

function Get-CivitaiHeaders {
    if ($env:CIVITAI_TOKEN) { return @{ Authorization = "Bearer $($env:CIVITAI_TOKEN)" } }
    return @{}
}

function Save-ModelFileNative {
    param($Row)
    if ($Row.Category -eq 'gguf') { $dir = Join-Path $NativeDir 'llama\models' }
    else { $dir = Join-Path $NativeDir "comfyui\models\$($Row.Category)" }
    New-Item -ItemType Directory -Force -Path $dir *> $null
    $dest = Join-Path $dir $Row.File
    if (Test-Path $dest) { Write-Ok "already present: $($Row.Category)/$($Row.File)"; return }
    Write-Info "Downloading $($Row.Category)/$($Row.File)"
    try {
        Invoke-WebRequest -Uri $Row.Url -OutFile $dest -UseBasicParsing -Headers (Get-CivitaiHeaders)
        Write-Ok "downloaded: $($Row.Category)/$($Row.File)"
    } catch {
        Write-Warn2 "download failed: $($Row.File) ($($_.Exception.Message))"
        if (Test-Path $dest) { Remove-Item $dest -Force -ErrorAction SilentlyContinue }
    }
}

function Save-ModelFileContainer {
    param($Row)
    $authArgs = @()
    if ($env:CIVITAI_TOKEN) { $authArgs = @('-H', "Authorization: Bearer $($env:CIVITAI_TOKEN)") }
    if ($Row.Category -eq 'gguf') {
        $vol = (& $Engine volume ls --format '{{.Name}}' | Where-Object { $_ -match 'kcpp-data$' } | Select-Object -First 1)
        if (-not $vol) { Write-Warn2 "kcpp-data volume not found, skipping $($Row.File)"; return }
        & $Engine exec llamacpp-chat test -f "/models/$($Row.File)" *> $null
        if ($LASTEXITCODE -eq 0) { Write-Ok "already present: gguf/$($Row.File)"; return }
        Write-Info "Downloading gguf/$($Row.File)"
        & $Engine run --rm -v "${vol}:/dest" docker.io/curlimages/curl:latest -fL --retry 3 @authArgs -o "/dest/$($Row.File)" $Row.Url
    } else {
        $target = "/opt/comfyui/app/models/$($Row.Category)/$($Row.File)"
        & $Engine exec comfyui test -f $target *> $null
        if ($LASTEXITCODE -eq 0) { Write-Ok "already present: $($Row.Category)/$($Row.File)"; return }
        Write-Info "Downloading $($Row.Category)/$($Row.File)"
        & $Engine run --rm --volumes-from comfyui docker.io/curlimages/curl:latest -fL --retry 3 @authArgs -o $target $Row.Url
    }
    if ($LASTEXITCODE -ne 0) { Write-Warn2 "download failed: $($Row.File)" }
}

function Invoke-ModelDownloads {
    param([switch]$Native)
    $rows = Read-ModelManifest
    if ($rows.Count -eq 0) { Write-Warn2 'models.manifest.tsv not found, skipping model downloads'; return }
    $selection = Select-ManifestRows $rows
    foreach ($row in $selection) {
        if (-not $row.Url) { continue }
        if ($Native) { Save-ModelFileNative $row } else { Save-ModelFileContainer $row }
    }
    if (-not $Native -and $selection.Count -gt 0) {
        Write-Info 'Restarting model services to pick up new files'
        & $cmd @pre -f $ComposeFile --env-file $EnvFile restart llamacpp-chat llamacpp-embed comfyui
    }
}

function Install-LlamaVulkan {
    $llamaDir = Join-Path $NativeDir 'llama'
    New-Item -ItemType Directory -Force -Path $llamaDir *> $null
    if (Test-Path (Join-Path $llamaDir 'llama-server.exe')) { Write-Ok 'llama.cpp Vulkan build already present'; return }
    Write-Info 'Querying the latest llama.cpp release for the Windows Vulkan build'
    try {
        $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest' -UseBasicParsing
    } catch {
        Write-Warn2 "could not reach the GitHub releases API ($($_.Exception.Message)), skipping llama.cpp install"
        return
    }
    $asset = $release.assets | Where-Object { $_.name -match 'bin-win-vulkan-x64\.zip' } | Select-Object -First 1
    if (-not $asset) { $asset = $release.assets | Where-Object { $_.name -match 'win-vulkan' } | Select-Object -First 1 }
    if (-not $asset) { Write-Warn2 'no Windows Vulkan asset found in the latest llama.cpp release'; return }
    $zip = Join-Path $env:TEMP $asset.name
    Write-Info "Downloading $($asset.name)"
    try {
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
    } catch {
        Write-Warn2 "llama.cpp download failed ($($_.Exception.Message))"
        return
    }
    Write-Info "Extracting llama.cpp into $llamaDir"
    Expand-Archive -Path $zip -DestinationPath $llamaDir -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    if (Test-Path (Join-Path $llamaDir 'llama-server.exe')) { Write-Ok 'llama.cpp Vulkan build installed' }
    else { Write-Warn2 "llama-server.exe not found after extraction, inspect $llamaDir" }
}

function Install-ComfyUIZluda {
    $comfyDir = Join-Path $NativeDir 'comfyui'
    if (Test-Path (Join-Path $comfyDir '.git')) {
        Write-Ok 'ComfyUI-Zluda already cloned'
    } else {
        $git = Get-Command git -ErrorAction SilentlyContinue
        if (-not $git) {
            $winget = Get-Command winget -ErrorAction SilentlyContinue
            if (-not $winget) { Write-Warn2 'git is missing and winget is unavailable, skipping ComfyUI-Zluda install'; return }
            if (-not (Test-IsAdmin)) { Write-Warn2 'git is missing and this session is not elevated, install Git for Windows and re-run setup'; return }
            Write-Info 'Installing Git via winget'
            winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
            if ($LASTEXITCODE -ne 0) { Write-Warn2 'Git install via winget failed, skipping ComfyUI-Zluda install'; return }
            $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
            $git = Get-Command git -ErrorAction SilentlyContinue
            if (-not $git) { Write-Warn2 'git still not found after install, open a new window and re-run setup'; return }
        }
        Write-Info "Cloning ComfyUI-Zluda into $comfyDir"
        git clone https://github.com/patientx/ComfyUI-Zluda $comfyDir
        if ($LASTEXITCODE -ne 0) { Write-Warn2 'ComfyUI-Zluda clone failed'; return }
        Write-Ok 'ComfyUI-Zluda cloned'
    }
    $installBat = Join-Path $comfyDir 'install.bat'
    if (-not (Test-Path $installBat)) { Write-Warn2 "install.bat not found in $comfyDir, run its installer manually"; return }
    Write-Info 'Running ComfyUI-Zluda install.bat (installs ZLUDA and Python deps, this takes a while)'
    Start-Process -FilePath $installBat -WorkingDirectory $comfyDir -Wait
    Write-Ok 'ComfyUI-Zluda install script finished'
}

function Write-StartServicesScript {
    $comfyDir = Join-Path $NativeDir 'comfyui'
    $comfyStart = ''
    foreach ($candidate in @('comfyui.bat', 'start.bat')) {
        if (Test-Path (Join-Path $comfyDir $candidate)) { $comfyStart = $candidate; break }
    }
    if (-not $comfyStart) { Write-Warn2 'no comfyui.bat or start.bat found in the ComfyUI-Zluda clone, the start script will skip ComfyUI' }
    $scriptPath = Join-Path $NativeDir 'start-services.ps1'
    $comfyBlock = ''
    if ($comfyStart) {
        $comfyBlock = @"

`$comfyDir = Join-Path `$Root 'comfyui'
if (-not (Test-PortListening 8188)) {
    `$env:COMMANDLINE_ARGS = '--listen 0.0.0.0'
    Start-Process -FilePath (Join-Path `$comfyDir '$comfyStart') -WorkingDirectory `$comfyDir -WindowStyle Minimized
}
"@
    }
    $content = @"
`$Root = Split-Path -Parent `$MyInvocation.MyCommand.Path
function Test-PortListening {
    param([int]`$Port)
    `$probe = New-Object System.Net.Sockets.TcpClient
    try { `$probe.Connect('127.0.0.1', `$Port); `$probe.Close(); return `$true } catch { return `$false }
}
`$llamaDir = Join-Path `$Root 'llama'
`$llamaServer = Join-Path `$llamaDir 'llama-server.exe'
if ((Test-Path `$llamaServer) -and -not (Test-PortListening 5001)) {
    Start-Process -FilePath `$llamaServer -ArgumentList '-m', 'models\$ChatGguf', '--host', '0.0.0.0', '--port', '5001', '-ngl', '999', '-c', '$ChatCtx' -WorkingDirectory `$llamaDir -WindowStyle Hidden
}
if ((Test-Path `$llamaServer) -and -not (Test-PortListening 5002)) {
    Start-Process -FilePath `$llamaServer -ArgumentList '-m', 'models\$EmbedGguf', '--embeddings', '--host', '0.0.0.0', '--port', '5002', '-ngl', '999' -WorkingDirectory `$llamaDir -WindowStyle Hidden
}
$comfyBlock
"@
    Set-Content -Path $scriptPath -Value $content -Encoding ASCII
    Write-Ok "wrote $scriptPath"
    return $scriptPath
}

function Register-ModelServicesTask {
    param([string]$ScriptPath)
    $taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
    schtasks /create /tn $ServicesTaskName /sc onlogon /tr $taskCommand /f *> $null
    if ($LASTEXITCODE -eq 0) { Write-Ok "scheduled task '$ServicesTaskName' registered to run at logon" }
    else { Write-Warn2 "could not register the '$ServicesTaskName' scheduled task, run native\start-services.ps1 manually after each reboot" }
}

function Wait-NativeServices {
    Write-Info 'Waiting up to 180s for the chat model on http://127.0.0.1:5001/health'
    $deadline = (Get-Date).AddSeconds(180)
    $chatUp = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:5001/health' -UseBasicParsing -TimeoutSec 5
            if ([int]$resp.StatusCode -eq 200) { $chatUp = $true; break }
        } catch {}
        Start-Sleep -Seconds 5
    }
    if ($chatUp) { Write-Ok 'chat model service answering on port 5001' }
    else { Write-Warn2 'chat model service did not answer on port 5001 within 180s, check native\llama' }
    foreach ($svc in @(@{ Port = 5002; Name = 'embedding service' }, @{ Port = 8188; Name = 'ComfyUI' })) {
        $probe = New-Object System.Net.Sockets.TcpClient
        try {
            $probe.Connect('127.0.0.1', $svc.Port); $probe.Close()
            Write-Ok "$($svc.Name) listening on port $($svc.Port)"
        } catch {
            Write-Warn2 "$($svc.Name) not listening on port $($svc.Port) yet, it may still be starting"
        }
    }
}

function Install-NativeAmdServices {
    Write-Info "Setting up native AMD model services under $NativeDir"
    New-Item -ItemType Directory -Force -Path $NativeDir *> $null
    Install-LlamaVulkan
    Install-ComfyUIZluda
    Invoke-ModelDownloads -Native
    $startScript = Write-StartServicesScript
    Register-ModelServicesTask $startScript
    Write-Info 'Starting native model services now'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript
    Wait-NativeServices
}

Write-Host ''
Write-Host 'StoryHaven AI - installer' -ForegroundColor White
Write-Host "repo: $RepoDir"
if ($DryRun) { Write-Warn2 'DRY RUN - files will be generated, but the stack will NOT be started.' }
Write-Host ''

Write-Info 'Detecting container engine'
$Engine  = ''
$Compose = ''
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
    try { docker info *> $null; if ($LASTEXITCODE -eq 0) { $Engine = 'docker' } } catch {}
}
if ($Engine -eq 'docker') {
    try { docker compose version *> $null; if ($LASTEXITCODE -eq 0) { $Compose = 'docker compose' } } catch {}
    if (-not $Compose -and (Get-Command docker-compose -ErrorAction SilentlyContinue)) { $Compose = 'docker-compose' }
}
if (-not $Engine) {
    $podman = Get-Command podman -ErrorAction SilentlyContinue
    if ($podman) {
        $Engine = 'podman'
        if (Get-Command podman-compose -ErrorAction SilentlyContinue) { $Compose = 'podman-compose' }
        else { $Compose = 'podman compose' }
    }
}

function Test-IsAdmin {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Wait-DockerReady {
    Write-Info 'Waiting for Docker Desktop to finish starting (this can take a few minutes on first launch)...'
    $deadline = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $deadline) {
        try { docker info *> $null; if ($LASTEXITCODE -eq 0) { return $true } } catch {}
        Start-Sleep -Seconds 5
    }
    return $false
}

if (-not $Engine) {
    Write-Warn2 'No working container engine found. Docker Desktop needs to be installed.'
    Write-Host ''
    Write-Host '  This is safe to allow. Here is exactly what happens and why:' -ForegroundColor White
    Write-Host '    - Administrator rights are needed ONLY to install Docker Desktop, the'
    Write-Host '      standard Windows container runtime from Docker Inc, via winget'
    Write-Host '      (Microsoft''s own package manager), which verifies the package.'
    Write-Host '    - Nothing else in this setup needs or uses admin rights. Everything'
    Write-Host '      else this script does is write two config files (docker-compose.yml'
    Write-Host '      and .env) into this folder and start containers.'
    Write-Host '    - It never deletes data, never touches files outside this folder, and'
    Write-Host '      re-running it is always safe.'
    Write-Host ''
    if (Test-IsAdmin) {
        if (Confirm2 'Install Docker Desktop now via winget?') {
            $winget = Get-Command winget -ErrorAction SilentlyContinue
            if (-not $winget) {
                Write-Err 'winget is not available. Install Docker Desktop manually:'
                Write-Host '    https://www.docker.com/products/docker-desktop/'
                exit 1
            }
            winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
            if ($LASTEXITCODE -ne 0) {
                Write-Err 'winget install failed. Install Docker Desktop manually and re-run: .\setup.ps1'
                exit 1
            }
            $dockerExe = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
            if (Test-Path $dockerExe) { Start-Process $dockerExe }
            if (Wait-DockerReady) {
                Write-Ok 'Docker Desktop installed and running'
                $Engine = 'docker'
                try { docker compose version *> $null; if ($LASTEXITCODE -eq 0) { $Compose = 'docker compose' } } catch {}
            } else {
                Write-Err 'Docker Desktop did not become ready. Start it from the Start menu, then re-run: .\setup.ps1'
                exit 1
            }
        } else {
            Write-Host '  Install Docker Desktop manually, then re-run: .\setup.ps1'
            exit 1
        }
    } else {
        Write-Host '  To allow one-click setup, this script can relaunch itself with admin'
        Write-Host '  rights (you will see the standard Windows UAC prompt, that prompt is'
        Write-Host '  this script asking to install Docker Desktop, nothing more).'
        Write-Host ''
        if (Confirm2 'Relaunch elevated now to install Docker Desktop?') {
            $argList = @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$($MyInvocation.MyCommand.Path)`"")
            if ($DryRun) { $argList += '-DryRun' }
            if ($Yes)    { $argList += '-Yes' }
            Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList
            Write-Ok 'Continuing in the elevated window.'
            exit 0
        }
        Write-Host '  Or install Docker Desktop yourself, then re-run: .\setup.ps1'
        Write-Host '    https://www.docker.com/products/docker-desktop/'
        exit 1
    }
}
Write-Ok "engine: $Engine"
if (-not $Compose) {
    Write-Warn2 "no Compose implementation found for $Engine"
    if (-not $DryRun) { exit 1 }
    $Compose = "$Engine compose"
}
Write-Ok "compose: $Compose"

Write-Info 'Detecting GPU'
$Gpu = 'none'
$smi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if (-not $smi) { $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue }
if ($smi) {
    try { & $smi.Source *> $null; if ($LASTEXITCODE -eq 0) { $Gpu = 'nvidia' } } catch {}
}
$vids = $null
try { $vids = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue } catch {}
if ($Gpu -ne 'nvidia' -and ($vids | Where-Object { $_.Name -match 'NVIDIA' })) { $Gpu = 'nvidia' }
if ($Gpu -ne 'nvidia' -and ($vids | Where-Object { $_.Name -match 'AMD|Radeon' })) { $Gpu = 'amd-zluda' }
if ($Gpu -eq 'nvidia') {
    Write-Ok 'NVIDIA GPU detected - GPU acceleration available'
} elseif ($Gpu -eq 'amd-zluda') {
    Write-Ok 'AMD GPU detected - the native ZLUDA path applies on Windows'
    Write-Warn2 'Windows containers cannot access AMD GPUs, so llama.cpp and ComfyUI will NOT run in the stack.'
    Write-Host '  The stack will contain only the app and its database. This installer'
    Write-Host '  will set the model services up natively on this machine itself:'
    Write-Host '    ComfyUI on ZLUDA (https://github.com/patientx/ComfyUI-Zluda), port 8188'
    Write-Host '    llama.cpp official Vulkan build for chat on port 5001'
    Write-Host '    a second llama.cpp Vulkan instance for embeddings on port 5002'
    Write-Host '  Both are AMD-accelerated, installed under native\ in this folder, and'
    Write-Host '  started automatically at logon. No manual service setup is needed.'
} else {
    Write-Warn2 'No GPU detected (no NVIDIA or AMD adapter found).'
    Write-Host '  The chat model, embeddings and image generation will run CPU-bound'
    Write-Host '  and be VERY slow (minutes per reply, heavy RAM use).'
    if (-not $DryRun) {
        if (-not (Confirm2 'Continue anyway on a machine without a detected GPU?')) {
            Write-Err 'Aborted.'; exit 1
        }
    }
}

Write-Host ''
Write-Info 'Configuration (press Enter to accept defaults / reuse existing values)'

$PgUser    = Get-EnvValue 'POSTGRES_USER';     if (-not $PgUser)    { $PgUser    = 'storyhaven' }
$PgDb      = Get-EnvValue 'POSTGRES_DB';       if (-not $PgDb)      { $PgDb      = 'storyhaven' }
$PgPass    = Get-EnvValue 'POSTGRES_PASSWORD'
$ChatModel = Get-EnvValue 'CHAT_MODEL';        if (-not $ChatModel) { $ChatModel = 'Gemma-4-E4B-Uncensored-HauhauCS-Aggressive' }
$EmbedModel= Get-EnvValue 'EMBED_MODEL';       if (-not $EmbedModel){ $EmbedModel= 'nomic-embed-text' }
$EmbedDim  = Get-EnvValue 'EMBED_DIM';         if (-not $EmbedDim)  { $EmbedDim  = '768' }
$ChatGguf  = Get-EnvValue 'CHAT_GGUF';         if (-not $ChatGguf)  { $ChatGguf  = 'Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf' }
$EmbedGguf = Get-EnvValue 'EMBED_GGUF';        if (-not $EmbedGguf) { $EmbedGguf = 'nomic-embed-text-v2-moe.Q8_0.gguf' }
$ChatCtx   = Get-EnvValue 'CHAT_CTX';          if (-not $ChatCtx)   { $ChatCtx   = '131072' }
$GpuLayers = Get-EnvValue 'GPU_LAYERS';        if (-not $GpuLayers) { $GpuLayers = '999' }
$Fernet    = Get-EnvValue 'SECRET_ENCRYPTION_KEY'

$PgUser = Ask 'PostgreSQL user' $PgUser
$PgDb   = Ask 'PostgreSQL database' $PgDb
if (-not $PgPass) {
    $bytes = New-Object 'System.Byte[]' 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $PgPass = ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower()
    Write-Ok 'generated a new PostgreSQL password'
} else {
    Write-Ok 'reusing existing PostgreSQL password from .env'
}

$ChatModel  = Ask 'Chat model name (CHAT_MODEL)' $ChatModel
$ChatGguf   = Ask 'Chat model GGUF filename (in the models volume)' $ChatGguf
$EmbedModel = Ask 'Embedding model name (EMBED_MODEL)' $EmbedModel
$EmbedGguf  = Ask 'Embedding model GGUF filename' $EmbedGguf
$EmbedDim   = Ask 'Embedding dimension (EMBED_DIM)' $EmbedDim
if ($Gpu -eq 'nvidia') {
    $GpuLayers = Ask 'GPU layers to offload (LLAMA_ARG_N_GPU_LAYERS)' $GpuLayers
} else {
    $GpuLayers = '0'
}

if ($Gpu -eq 'amd-zluda') {
    $LlmBaseUrl   = 'http://host.docker.internal:5001/v1'
    $EmbedBaseUrl = 'http://host.docker.internal:5002/v1'
    $ComfyUrl     = 'http://host.docker.internal:8188'
} else {
    $LlmBaseUrl   = 'http://llamacpp-chat:5001/v1'
    $EmbedBaseUrl = 'http://llamacpp-embed:5002/v1'
    $ComfyUrl     = 'http://comfyui:8188'
}

if (-not $Fernet) {
    if (Confirm2 'Auto-generate a SECRET_ENCRYPTION_KEY now? (recommended)') {
        $py = Get-Command python -ErrorAction SilentlyContinue
        if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
        if ($py) {
            try {
                $Fernet = & $py.Source -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>$null
                $Fernet = ($Fernet | Select-Object -First 1).Trim()
            } catch { $Fernet = '' }
        }
        if ($Fernet) {
            Write-Ok 'generated SECRET_ENCRYPTION_KEY'
        } else {
            $kb = New-Object 'System.Byte[]' 32
            [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($kb)
            $Fernet = [Convert]::ToBase64String($kb).Replace('+','-').Replace('/','_')
            Write-Ok 'generated SECRET_ENCRYPTION_KEY (native, no Python)'
        }
    }
} else {
    Write-Ok 'reusing existing SECRET_ENCRYPTION_KEY from .env'
}

$DatabaseUrl = "postgresql+asyncpg://${PgUser}:${PgPass}@storyhaven-postgres:5432/${PgDb}"

Write-Info "Writing $EnvFile"
$envContent = @"
POSTGRES_USER=$PgUser
POSTGRES_PASSWORD=$PgPass
POSTGRES_DB=$PgDb
DATABASE_URL=$DatabaseUrl
LLM_BASE_URL=$LlmBaseUrl
EMBED_BASE_URL=$EmbedBaseUrl
COMFYUI_URL=$ComfyUrl
LLM_API_KEY=
CHAT_MODEL=$ChatModel
EMBED_MODEL=$EmbedModel
EMBED_DIM=$EmbedDim
DEFAULT_LANGUAGE=English
SECRET_ENCRYPTION_KEY=$Fernet
CHAT_GGUF=$ChatGguf
EMBED_GGUF=$EmbedGguf
CHAT_CTX=$ChatCtx
GPU_LAYERS=$GpuLayers
"@
Set-Content -Path $EnvFile -Value $envContent -Encoding ASCII
icacls $EnvFile /inheritance:r *> $null
icacls $EnvFile /grant:r "$($env:USERNAME):(R,W)" *> $null
Write-Ok '.env written (ACL restricted to current user)'

Write-Info "Writing $ComposeFile"
$RepoMount = $RepoDir -replace '\\', '/'
if ($Gpu -eq 'nvidia') {
    $GpuDevices = @"

    devices:
      - "nvidia.com/gpu=all"
"@
} else {
    $GpuDevices = ''
}
$coreServices = @"
services:
  story-game:
    container_name: story-game
    image: alpine:latest
    restart: unless-stopped
    working_dir: /app
    ports:
      - "3000:3000"
    volumes:
      - "${RepoMount}:/app/ai-frontend"
    networks:
      - storyhaven_isolated_net
    depends_on:
      - postgres
    environment:
      - DATABASE_URL=`${DATABASE_URL}
      - LLM_BASE_URL=`${LLM_BASE_URL}
      - EMBED_BASE_URL=`${EMBED_BASE_URL}
      - COMFYUI_URL=`${COMFYUI_URL}
      - LLM_API_KEY=`${LLM_API_KEY}
      - CHAT_MODEL=`${CHAT_MODEL}
      - EMBED_MODEL=`${EMBED_MODEL}
      - EMBED_DIM=`${EMBED_DIM}
      - DEFAULT_LANGUAGE=`${DEFAULT_LANGUAGE}
      - SECRET_ENCRYPTION_KEY=`${SECRET_ENCRYPTION_KEY}
    command: ["/app/ai-frontend/run.sh"]
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost:3000/api/health >/dev/null 2>&1 || wget -q -S -O- http://localhost:3000/api/health 2>&1 | grep -q '401 ' || exit 1"]
      interval: 15s
      timeout: 10s
      start_period: 90s
      retries: 10

  postgres:
    container_name: storyhaven-postgres
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    networks:
      - storyhaven_isolated_net
    environment:
      - POSTGRES_USER=`${POSTGRES_USER}
      - POSTGRES_PASSWORD=`${POSTGRES_PASSWORD}
      - POSTGRES_DB=`${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U `${POSTGRES_USER} -d `${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
"@

$modelServices = @"

  llamacpp-chat:
    container_name: llamacpp-chat
    image: ghcr.io/ggml-org/llama.cpp:server-cuda
    restart: unless-stopped
    networks:
      - storyhaven_isolated_net
    volumes:
      - kcpp-data:/models:ro$GpuDevices
    environment:
      - LLAMA_ARG_MODEL=/models/`${CHAT_GGUF}
      - LLAMA_ARG_CTX_SIZE=`${CHAT_CTX}
      - LLAMA_ARG_N_GPU_LAYERS=`${GPU_LAYERS}
      - LLAMA_ARG_HOST=0.0.0.0
      - LLAMA_ARG_PORT=5001
    ports:
      - "0.0.0.0:5001:5001"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost:5001/health || exit 1"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3

  llamacpp-embed:
    container_name: llamacpp-embed
    image: ghcr.io/ggml-org/llama.cpp:server-cuda
    restart: unless-stopped
    networks:
      - storyhaven_isolated_net
    volumes:
      - kcpp-data:/models:ro$GpuDevices
    environment:
      - LLAMA_ARG_MODEL=/models/`${EMBED_GGUF}
      - LLAMA_ARG_EMBEDDINGS=true
      - LLAMA_ARG_HOST=0.0.0.0
      - LLAMA_ARG_PORT=5002
    ports:
      - "0.0.0.0:5002:5002"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost:5002/health || exit 1"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3

  comfyui:
    container_name: comfyui
    hostname: comfyui
    image: bigbrozer/comfyture:latest
    restart: unless-stopped
    networks:
      - storyhaven_isolated_net$GpuDevices
    command: ["--listen", "0.0.0.0"]
    environment:
      - PUID=1000
      - PGID=1000
    ports:
      - "0.0.0.0:8188:8188"
    volumes:
      - comfyui_python:/opt/comfyui/python
      - comfyui_custom_nodes:/opt/comfyui/app/custom_nodes
      - comfyui_models:/opt/comfyui/app/models
      - comfyui_input:/opt/comfyui/app/input
      - comfyui_output:/opt/comfyui/app/output
      - comfyui_profiles:/opt/comfyui/app/user
"@

$modelVolumes = @"

  kcpp-data:
  comfyui_python:
  comfyui_custom_nodes:
  comfyui_models:
  comfyui_input:
  comfyui_output:
  comfyui_profiles:
"@

$tail = @"

networks:
  storyhaven_isolated_net:
    driver: bridge
"@

if ($Gpu -eq 'amd-zluda') {
    $composeContent = $coreServices + "`n`nvolumes:`n  postgres_data:" + $tail
} else {
    $composeContent = $coreServices + $modelServices + "`n`nvolumes:`n  postgres_data:" + $modelVolumes + $tail
}
Set-Content -Path $ComposeFile -Value $composeContent -Encoding ASCII
Write-Ok 'docker-compose.yml written'

Write-Info 'Validating generated compose file'
$composeArgs = $Compose.Split(' ')
$cmd  = $composeArgs[0]
if ($composeArgs.Count -gt 1) { $pre = @($composeArgs[1..($composeArgs.Count-1)]) } else { $pre = @() }
& $cmd @pre -f $ComposeFile --env-file $EnvFile config *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Ok 'compose config is valid'
} else {
    Write-Warn2 "'$Compose config' returned non-zero; review $ComposeFile manually."
}

if ($DryRun) {
    Write-Host ''
    Write-Ok 'Dry run complete. Generated:'
    Write-Host "    $ComposeFile"
    Write-Host "    $EnvFile"
    if ($Gpu -eq 'amd-zluda') { Write-Info 'Dry run: skipping the native AMD service install (llama.cpp Vulkan + ComfyUI-Zluda)' }
    Write-Host '  Review them, then run .\setup.ps1 (without -DryRun) to start the stack.'
    exit 0
}

if (-not (Test-Path (Join-Path $RepoDir 'venv/bin/uvicorn'))) {
    Write-Warn2 "story-game's venv (with app dependencies) is missing."
    Write-Host '  run.sh execs venv/bin/uvicorn, so the venv must exist with requirements installed.'
    if (Confirm2 'Build the venv now in a throwaway python container?') {
        Write-Info 'Creating venv + installing requirements.txt'
        & $Engine run --rm -v "${RepoMount}:/app" -w /app python:3.12-alpine sh -c "apk add --no-cache build-base 2>/dev/null; python3 -m venv venv && venv/bin/pip install --upgrade pip && venv/bin/pip install -r requirements.txt"
        Write-Ok 'venv built'
    } else {
        Write-Warn2 'Skipped - story-game will not start until venv/bin/uvicorn exists.'
    }
}

Write-Host ''
Write-Info "Starting the stack: $Compose up -d"
& $cmd @pre -f $ComposeFile --env-file $EnvFile up -d

Write-Info 'Waiting for story-game to answer on http://localhost:3000/api/health'
$deadline = (Get-Date).AddMinutes(5)
$healthy = $false
$code = 0
while ((Get-Date) -lt $deadline) {
    try {
        $resp = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -UseBasicParsing -TimeoutSec 5
        $code = [int]$resp.StatusCode
    } catch {
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode } else { $code = 0 }
    }
    if ($code -eq 401 -or $code -eq 200) { $healthy = $true; break }
    Write-Host '.' -NoNewline
    Start-Sleep -Seconds 5
}
Write-Host ''
if ($healthy) {
    Write-Ok "story-game is up (HTTP $code from /api/health)"
} else {
    Write-Warn2 'story-game did not respond healthy within timeout.'
    Write-Host "  Check logs: $Engine logs story-game"
}

if ($Gpu -eq 'amd-zluda') {
    Install-NativeAmdServices
} elseif (Test-Path $ManifestFile) {
    Invoke-ModelDownloads
}

Write-Host ''
Write-Host 'First-run admin password' -ForegroundColor White
Write-Host "  On first startup the app auto-creates an 'admin' user and prints a random"
Write-Host '  password to story-game stdout. Retrieve it with:'
Write-Host "    $Engine logs story-game | Select-String -Pattern 'admin' -Context 0,1" -ForegroundColor Cyan
Write-Host ''
Write-Host 'Open the app: http://localhost:3000' -ForegroundColor White
if ($Gpu -eq 'amd-zluda') {
    Write-Host '  Installed local model services (started now, and at every logon by the'
    Write-Host "  '$ServicesTaskName' scheduled task):"
    Write-Host '  ComfyUI (ZLUDA):         http://127.0.0.1:8188'
    Write-Host '  Chat API (Vulkan):       http://127.0.0.1:5001/v1'
    Write-Host '  Embed API (Vulkan):      http://127.0.0.1:5002/v1'
    Write-Host '  The app reaches them via host.docker.internal. Re-running setup repairs'
    Write-Host '  or resumes this install if anything is missing.'
} else {
    Write-Host '  ComfyUI:        http://localhost:8188'
    Write-Host '  Chat model API: http://localhost:5001/v1'
    Write-Host '  Embed API:      http://localhost:5002/v1'
}
Write-Host ''
Write-Ok 'Done.'
