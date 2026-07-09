StoryHaven AI - Windows installer
=================================

This installer:
  1. Downloads the StoryHaven AI application source with Git into the
     install folder (subfolder "app").
  2. Installs the PowerShell setup script (setup.ps1).
  3. On the finish screen, optionally runs setup.ps1, which detects Docker
     Desktop, checks for an NVIDIA GPU, generates docker-compose.yml + .env,
     and brings the whole stack up.

Requirements on the target machine:
  * Git for Windows      https://git-scm.com/download/win
  * Docker Desktop       https://www.docker.com/products/docker-desktop/
    (setup.ps1 detects Docker and guides you if it is missing.)
  * NVIDIA GPU + driver with WSL2 CUDA (recommended; CPU-only works but is
    very slow).

To re-run setup later: Start Menu -> "Run StoryHaven AI setup".

To open the app once it is running: http://localhost:3000
The first-run admin password is printed to the story-game container log:
  docker logs story-game | Select-String admin
