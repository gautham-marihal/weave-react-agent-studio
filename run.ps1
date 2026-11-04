# Weave Studio in Docker, on Windows (Docker Desktop). On Linux or a Mac, use run.sh. From this folder:
#   .\run.cmd start            build and start the studio on http://localhost:5173 (private: this computer only)
#   .\run.cmd start -Https     the same, plus Caddy: HTTPS and a password on STUDIO_DOMAIN (ports 80 and 443)
#   .\run.cmd start -Demo      also the demo studio (sample data, no key) on http://localhost:8090
#   .\run.cmd start -Mock      also the mock bank API on http://localhost:4400
#   .\run.cmd stop             stop everything this folder started
#   .\run.cmd status           what is running, and whether the studio answers
#   .\run.cmd logs [service]   follow the logs (studio, caddy, studio-demo, mock-api)
#   .\run.cmd export           build, then save every image this folder uses to docker-images\weave-studio-images.tar
#   .\run.cmd import           on another computer: load that file and start without building (same options as start)
#   .\run.cmd export-windows   on a Linux engine: build the Windows-container images into docker-images\windows
# On a Windows host whose Docker runs Windows containers, every command uses docker-compose.windows.yml and those images
# (import loads them; nothing is built there).
# It uses Docker Desktop when it is running, else Docker Engine inside WSL 2 (see NeedDocker below).
# run.cmd runs this file with PowerShell; in a PowerShell window, .\run.ps1 start works too where scripts are allowed.
# The settings are in .env.docker (made from .env.docker.example the first time) and who may sign in in credentials.txt.
param(
  [Parameter(Position = 0)][string]$Command = 'start',
  [Parameter(Position = 1)][string]$Service = '',
  [switch]$Https,
  [switch]$Demo,
  [switch]$Mock
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$EnvFile = '.env.docker'
$Images = 'docker-images\weave-studio-images.tar'

function Fail([string]$Message) {
  Write-Host "Stopped: $Message" -ForegroundColor Red
  exit 1
}

# one setting's value from .env.docker (the last line that sets it), without quotes; empty when unset
function Setting([string]$Name) {
  if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { return '' }
  $value = ''
  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    if ($line -match "^\s*$Name=(.*)$") { $value = $Matches[1].Trim() }
  }
  if ($value -match '^"(.*)"$' -or $value -match "^'(.*)'$") { $value = $Matches[1] }
  return $value
}

function PortOf([string]$Name, [string]$Default) {
  $value = Setting $Name
  if ($value) { return $value }
  return $Default
}

# runs docker with these arguments; a failure stops the script (not named Docker: PowerShell names ignore case, so
# `docker` inside it would call itself)
function RunDocker([string[]]$Arguments) {
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) { Fail "docker $($Arguments -join ' ') failed (see above)." }
}

# the switches given here, as run.sh spells them
function ShOptions {
  $options = @()
  if ($Https) { $options += '--https' }
  if ($Demo) { $options += '--demo' }
  if ($Mock) { $options += '--mock' }
  return $options
}

# Which Docker runs it: Docker Desktop (docker.exe on Windows) when it is running, else Docker Engine inside WSL 2, where
# run.sh does the same work. RUN_DOCKER=windows or RUN_DOCKER=wsl picks one. (The checks go through cmd, so Windows
# PowerShell 5.1 doesn't turn docker's error text into its own error.)
function WindowsDocker {
  if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { return $false }
  cmd /c 'docker info >nul 2>&1'
  return ($LASTEXITCODE -eq 0)
}

function WslDocker {
  if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { return $false }
  # a docker under /mnt/ is Docker Desktop's pointer, not an engine; a real one may need a few seconds after WSL starts
  cmd /c 'wsl.exe -e sh -c "d=$(command -v docker) || exit 1; case $d in /mnt/*) exit 1;; esac; for i in 1 2 3 4 5; do docker info >/dev/null 2>&1 && exit 0; sleep 2; done; exit 1" >nul 2>&1'
  return ($LASTEXITCODE -eq 0)
}

# hands the whole command to run.sh inside WSL, in this same folder, and ends with its result
function RunInWsl {
  $arguments = @('--cd', $PSScriptRoot, '-e', 'bash', './run.sh', $Command) + (ShOptions)
  if ($Command -eq 'logs' -and $Service) { $arguments += $Service }
  Write-Host 'Using Docker Engine inside WSL (Docker Desktop is not running here).'
  & wsl.exe @arguments
  exit $LASTEXITCODE
}

$WslSteps = 'In PowerShell: wsl --install (then restart). In the Ubuntu window: curl -fsSL https://get.docker.com | sudo sh, then sudo usermod -aG docker $USER, then wsl --shutdown in PowerShell. See DEPLOY.md.'

function NeedDocker {
  if ($env:RUN_DOCKER -eq 'wsl') {
    if (-not (WslDocker)) { Fail "RUN_DOCKER=wsl, but Docker Engine doesn't answer inside WSL. $WslSteps" }
    RunInWsl
  }
  if (WindowsDocker) {
    cmd /c 'docker compose version >nul 2>&1'
    if ($LASTEXITCODE -ne 0) { Fail 'The Docker Compose plugin is missing: update Docker Desktop.' }
    return
  }
  if ($env:RUN_DOCKER -ne 'windows' -and (WslDocker)) { RunInWsl }
  if (Get-Command docker.exe -ErrorAction SilentlyContinue) {
    Fail "Docker Desktop is not running: start it, wait until it says it is running, then run this again. Or use Docker Engine inside WSL 2: $WslSteps"
  }
  Fail "No Docker found. Install Docker Desktop (https://docs.docker.com/desktop/setup/install/windows-install/), or Docker Engine inside WSL 2: $WslSteps"
}

# Docker in Windows-containers mode (Windows Server, or Docker Desktop switched to it) runs the Windows images with
# docker-compose.windows.yml; a Linux engine (Docker Desktop's usual mode, WSL) runs the Linux images
$WindowsImages = 'docker-images\windows'
function UseEngine {
  $script:OnWindows = ((& docker info --format '{{.OSType}}') -eq 'windows')
  # @(...) keeps it a list even with one item (PowerShell would otherwise make @('compose') a plain string)
  $script:Compose = @(if ($script:OnWindows) { 'compose', '-f', 'docker-compose.windows.yml' } else { 'compose' })
}

# builds each Windows image on this Linux engine (the Windows part of each Dockerfile only copies files in) and saves it
# to docker-images\windows\<name>.tar for the Windows host. WINDOWS_VERSION in the settings: ltsc2022 (default) or
# ltsc2025, the Windows Server version the images are for.
function ExportWindows($builds) {
  if ($script:OnWindows) { Fail 'export-windows builds on a Linux engine (Docker Desktop in its usual mode, or a Linux server), not on Docker running Windows containers.' }
  cmd /c 'docker buildx inspect weave-windows >nul 2>&1'
  if ($LASTEXITCODE -ne 0) { RunDocker @('buildx', 'create', '--name', 'weave-windows', '--driver', 'docker-container') }
  $version = PortOf 'WINDOWS_VERSION' 'ltsc2022'
  New-Item -ItemType Directory -Force -Path $WindowsImages | Out-Null
  foreach ($b in $builds) {
    $tag, $file, $context, $extra = $b
    $dest = Join-Path $WindowsImages "$($tag.Split(':')[0]).tar"
    Write-Host "Building $tag (Windows $version)..."
    $arguments = @('buildx', 'build', '--builder', 'weave-windows', '--platform', 'windows/amd64', '-f', $file, '--build-arg', "WINDOWS_VERSION=$version")
    foreach ($arg in $extra) { $arguments += @('--build-arg', $arg) }
    RunDocker ($arguments + @('--output', "type=docker,name=$tag,dest=$dest", $context))
  }
  Write-Host ''
  Get-ChildItem -LiteralPath $WindowsImages -Filter '*.tar' | ForEach-Object { Write-Host ('Saved {0} ({1} MB)' -f (Join-Path $WindowsImages $_.Name), [math]::Round($_.Length / 1MB)) -ForegroundColor Green }
  Write-Host 'On the Windows host (Docker in Windows-containers mode): copy this folder with docker-images\windows, fill in the settings, then .\run.cmd import.'
}

# the settings and the sign-in file, checked before anything is built
function CheckFiles {
  if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    Copy-Item -LiteralPath '.env.docker.example' -Destination $EnvFile
    Fail "$EnvFile was missing, so it was made from .env.docker.example. Fill in AGENT_BUILDER_API_KEY (and the rest as the file says), then run this again."
  }
  if (-not (Setting 'AGENT_BUILDER_API_KEY')) { Fail "AGENT_BUILDER_API_KEY is empty in $EnvFile." }
  if (Test-Path -LiteralPath 'credentials.txt' -PathType Container) {
    Fail 'credentials.txt is a folder (Docker makes one when the file is missing). Delete it, create the file, then run this again.'
  }
  if (-not (Test-Path -LiteralPath 'credentials.txt' -PathType Leaf)) {
    Fail 'credentials.txt is missing: create it, one person per line (email, a space, the password).'
  }
}

function CheckHttps {
  foreach ($name in 'STUDIO_DOMAIN', 'STUDIO_USER', 'STUDIO_PASSWORD_HASH') {
    if (-not (Setting $name)) { Fail "$name is empty in $EnvFile (needed for -Https; see DEPLOY.md)." }
  }
}

function StudioState {
  $id = (& docker @($Compose + @('ps', '-q', 'studio'))) | Select-Object -First 1
  if (-not $id) { return 'not running' }
  return (& docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $id)
}

# waits for the studio's health check: healthy, or why not
function WaitHealthy {
  for ($i = 0; $i -lt 45; $i++) {
    $state = StudioState
    if ($state -eq 'healthy') { return }
    if ($state -in 'unhealthy', 'exited', 'dead', 'not running') { Fail "the studio is $state (.\run.cmd logs studio)." }
    Start-Sleep -Seconds 2
  }
  Fail 'the studio did not become healthy in 90 seconds (.\run.cmd logs studio).'
}

$all = @('--profile', 'https', '--profile', 'demo', '--profile', 'mock')
$profiles = @()
if ($Https) { $profiles += @('--profile', 'https') }
if ($Demo) { $profiles += @('--profile', 'demo') }
if ($Mock) { $profiles += @('--profile', 'mock') }

switch ($Command) {
  { $_ -in 'start', 'import' } {
    NeedDocker
    UseEngine
    CheckFiles
    if ($Https) { CheckHttps }
    if ($OnWindows) {
      if ($Command -eq 'import') {
        $tars = @(Get-ChildItem -Path (Join-Path $WindowsImages '*.tar') -ErrorAction SilentlyContinue)
        if (-not $tars.Count) { Fail "No Windows images in ${WindowsImages}: on a computer with a Linux engine, run .\run.cmd export-windows (or ./run.sh export-windows), then copy that folder here." }
        foreach ($tar in $tars) {
          Write-Host "Loading $($tar.Name)..."
          RunDocker @('load', '-i', $tar.FullName)
        }
      } else {
        cmd /c 'docker image inspect weave-studio:windows >nul 2>&1'
        if ($LASTEXITCODE -ne 0) { Fail 'The Windows images are not loaded here yet: run .\run.cmd import first (Docker in Windows-containers mode builds nothing).' }
      }
      Write-Host 'Starting the Windows images (nothing is built)...'
      RunDocker ($Compose + $profiles + @('up', '-d', '--no-build'))
    } elseif ($Command -eq 'import') {
      if (-not (Test-Path -LiteralPath $Images -PathType Leaf)) { Fail "$Images is missing: on the computer that built the images, run .\run.cmd export, then copy the file here." }
      Write-Host "Loading the images from $Images..."
      RunDocker @('load', '-i', $Images)
      Write-Host 'Starting (nothing is built)...'
      RunDocker ($Compose + $profiles + @('up', '-d', '--no-build'))
    } else {
      Write-Host 'Building and starting (the first build takes a few minutes)...'
      RunDocker ($Compose + $profiles + @('up', '--build', '-d'))
    }
    WaitHealthy
    $port = PortOf 'STUDIO_PORT' '5173'
    Write-Host ''
    Write-Host "Weave Studio is running: http://localhost:$port" -ForegroundColor Green
    if ($Https) { Write-Host "  and on https://$(Setting 'STUDIO_DOMAIN') (Caddy gets the certificate; give it a minute the first time)" }
    if ($Demo) { Write-Host "  the demo studio: http://localhost:$(PortOf 'STUDIO_DEMO_PORT' '8090')" }
    if ($Mock) { Write-Host "  the mock bank API: http://localhost:$(PortOf 'MOCK_API_PORT' '4400')" }
    Write-Host 'Sign in with a line of credentials.txt. Stop it with: .\run.cmd stop'
  }
  'export' {
    NeedDocker
    UseEngine
    if ($OnWindows) { Fail 'export builds the Linux images, on a Linux engine. On this Windows-containers host, use import with docker-images\windows (made by export-windows elsewhere).' }
    Write-Host 'Building from these files first, so the saved images are current...'
    RunDocker @('compose', 'build')
    $found = @()
    foreach ($image in (& docker compose --profile https --profile demo --profile mock config --images)) {
      # Caddy comes from Docker Hub: fetched here, so the file also works on a computer without internet
      if ($image -like 'caddy:*') {
        cmd /c "docker image inspect $image >nul 2>&1"
        if ($LASTEXITCODE -ne 0) { RunDocker @('pull', $image) }
      }
      cmd /c "docker image inspect $image >nul 2>&1"
      if ($LASTEXITCODE -eq 0) { $found += $image } else { Write-Host "  left out (not built here): $image" }
    }
    New-Item -ItemType Directory -Force -Path 'docker-images' | Out-Null
    Write-Host "Saving $($found -join ' ') to $Images..."
    RunDocker (@('save', '-o', $Images) + $found)
    $size = [math]::Round((Get-Item -LiteralPath $Images).Length / 1MB)
    Write-Host ''
    Write-Host "Saved $Images ($size MB)." -ForegroundColor Green
    Write-Host 'On the other computer: copy this folder (with that file; without node_modules), fill in .env.docker, then .\run.cmd import (or ./run.sh import on Linux).'
  }
  'export-windows' {
    NeedDocker
    UseEngine
    ExportWindows @(
      @('weave-studio:windows', 'Dockerfile.windows', '.', @()),
      @('weave-studio-demo:windows', 'Dockerfile.windows', '.', @('VITE_DEMO_MODE=true')),
      @('weave-mock-api:windows', 'mock-api\Dockerfile.windows', 'mock-api', @()),
      @('caddy-nano:windows', 'Dockerfile.caddy.windows', '.', @())
    )
  }
  'stop' {
    NeedDocker
    UseEngine
    RunDocker ($Compose + $all + @('down'))
    Write-Host 'Stopped. Settings, sign-ins and certificates are kept; .\run.cmd start brings it back.'
  }
  'status' {
    NeedDocker
    UseEngine
    RunDocker ($Compose + $all + @('ps'))
    Write-Host "studio: $(StudioState)"
  }
  'logs' {
    NeedDocker
    UseEngine
    $arguments = $Compose + $all + @('logs', '-f', '--tail', '100')
    if ($Service) { $arguments += $Service }
    & docker @arguments
  }
  default { Fail "unknown command $Command (start, stop, status, logs, export, import or export-windows)" }
}
