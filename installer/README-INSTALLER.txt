StoryHaven AI - Windows installer
=================================

One click is the goal. Run the installer, keep clicking Next, and at the end
tick "Run StoryHaven AI setup". The setup script does everything else,
including installing Docker Desktop for you if it is missing.

Is this safe? Yes, and here is exactly why:
  * The installer asks for administrator rights ONCE, up front. Those rights
    are used for exactly two things: putting the app files in the install
    folder, and (only if Docker Desktop is missing) installing Docker Desktop
    through winget, which is Microsoft's own package manager and verifies
    what it downloads.
  * Docker Desktop is the standard container runtime from Docker Inc. It is
    what actually runs the app. Nothing unofficial is downloaded.
  * The setup script itself only writes two configuration files
    (docker-compose.yml and .env) inside the install folder and starts the
    app's containers. It never touches your files anywhere else, never
    deletes anything, and running it again later is always safe.

What the installer does, in order:
  1. Downloads the StoryHaven AI application source with Git into the
     install folder (subfolder "app").
  2. Installs the PowerShell setup script (setup.ps1).
  3. On the finish screen, optionally runs setup.ps1, which installs Docker
     Desktop if needed, detects your GPU, generates docker-compose.yml and
     .env, and brings the whole stack up.

GPU support:
  * NVIDIA: fully automatic. Install a recent NVIDIA driver with WSL2 CUDA
    support for acceleration.
  * AMD: fully automatic too. Windows containers cannot use AMD GPUs, so the
    script installs the model services natively on this PC instead. ComfyUI
    runs on ZLUDA, chat and embeddings run on llama.cpp's official Vulkan
    build, all AMD-accelerated, all installed and started by setup itself.
  * No GPU: everything still works on CPU, just very slowly.

What your PC needs:
  * Windows 10 or 11, 64-bit, with WSL2 enabled
  * 16 GB of memory (32 GB is better)
  * 40 GB of free disk space (250 GB if you download every model)
  * A graphics card with 12 GB of video memory for the best experience.
    8 GB works at reduced speed. No graphics card also works, but replies
    will take minutes instead of seconds.
  * No graphics card? Connect DeepSeek instead: create a key at
    https://platform.deepseek.com and paste it into the app's Settings as
    the chat endpoint (https://api.deepseek.com, model deepseek-chat).
    Replies become fast again and cost pennies. Everything else keeps
    working locally.

Requirements the installer checks or handles for you:
  * Git for Windows      https://git-scm.com/download/win
  * Docker Desktop       installed automatically if missing

To re-run setup later: Start Menu -> "Run StoryHaven AI setup".

To open the app once it is running: http://localhost:3000
The first-run admin password is printed to the story-game container log:
  docker logs story-game | Select-String admin
