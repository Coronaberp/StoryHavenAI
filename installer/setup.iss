; StoryHaven AI - Windows installer (Inno Setup script)
; ---------------------------------------------------------------------------
; Produces a wizard that:
;   * shows welcome / license / install-location / progress / finish screens
;   * installs the PowerShell installer (setup.ps1) + a compose template
;   * clones (or updates) the StoryHaven AI app repo into the install dir
;     during install, so the heavy app payload is NOT bundled in the .exe
;   * on finish, optionally runs setup.ps1 (elevated) to bring the stack up
;   * drops a Start-menu / desktop shortcut that re-runs setup.ps1 elevated
;
; Compile on a Windows machine with Inno Setup 6 installed:
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\setup.iss
; Output: installer\Output\StoryHavenAI-Setup.exe
;
; Requires: Git for Windows (for the clone step) and Docker Desktop on the
; target machine. setup.ps1 itself detects Docker and guides the user if it
; is missing, so this installer does not hard-fail on a missing engine.
; ---------------------------------------------------------------------------

#define MyAppName "StoryHaven AI"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "StoryHaven"
#define MyAppURL "https://github.com/staygold/ai-frontend"
#define RepoUrl "https://github.com/staygold/ai-frontend.git"

[Setup]
AppId={{B7B4F0F2-8B2E-4C4A-9E1A-4D9C7A1F2C33}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\StoryHavenAI
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=StoryHavenAI-Setup
SetupIconFile=..\storyhaven_logo.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Docker operations and writing under Program Files need elevation.
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
; To show a license/EULA page, add a LICENSE file at the repo root and
; uncomment the next line:
;LicenseFile=..\LICENSE

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut to re-run setup"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
; Bundle only the lightweight installer payload. The full app is cloned at
; install time by the [Run] git step below, keeping this .exe small.
Source: "..\setup.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\setup.sh"; DestDir: "{app}"; Flags: ignoreversion
Source: "README-INSTALLER.txt"; DestDir: "{app}"; Flags: ignoreversion isreadme
Source: "models.manifest.tsv"; DestDir: "{app}\app\installer"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\storyhaven_logo.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Run StoryHaven AI setup"; Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\app\setup.ps1"""; \
  WorkingDir: "{app}\app"; IconFilename: "{app}\storyhaven_logo.ico"
Name: "{group}\Open StoryHaven AI (browser)"; Filename: "http://localhost:3000"; IconFilename: "{app}\storyhaven_logo.ico"
Name: "{autodesktop}\StoryHaven AI setup"; Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\app\setup.ps1"""; \
  WorkingDir: "{app}\app"; IconFilename: "{app}\storyhaven_logo.ico"; Tasks: desktopicon

[Run]
; 1) Clone the app repo into {app}\app, or pull if it already exists (idempotent).
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""if (Test-Path '{app}\app\.git') {{ git -C '{app}\app' pull --ff-only }} else {{ git clone {#RepoUrl} '{app}\app' }}"""; \
  StatusMsg: "Fetching StoryHaven AI application source..."; \
  Flags: runhidden waituntilterminated

; 2) Copy the bundled setup.ps1 into the cloned app dir so shortcuts and the
;    finish-step run the same script against the app checkout.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Copy-Item -Force '{app}\setup.ps1' '{app}\app\setup.ps1'"""; \
  Flags: runhidden waituntilterminated

; 3) Optionally launch the interactive installer now (in a visible console).
Filename: "powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{app}\app\setup.ps1"""; \
  WorkingDir: "{app}\app"; \
  Description: "Run StoryHaven AI setup now (detect Docker, generate config, start the stack)"; \
  Flags: postinstall shellexec

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app"

[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  // Warn (do not block) if Git is not on PATH - the clone step needs it.
  if not Exec('cmd.exe', '/c where git', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
    MsgBox('Git was not found on PATH.' + #13#10 +
           'StoryHaven AI is downloaded with Git during install.' + #13#10 +
           'Install Git for Windows from https://git-scm.com/download/win, ' +
           'then run this installer again.', mbInformation, MB_OK);
end;
