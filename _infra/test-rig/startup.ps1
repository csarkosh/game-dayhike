# Sets the machine up on its first boot: the NVIDIA driver, OpenSSH Server,
# Chrome, Node 22 and Git with LFS. Runs at every boot (it is the instance's
# windows-startup-script-ps1, run as SYSTEM by Google's guest agent), and
# returns at once when the marker file from a finished set-up exists.
#
# Idempotent step by step, not only as a whole: each step checks for what it
# installs before installing it, and the marker is written only after every
# step has succeeded. A boot that fails half-way is retried by the next boot
# from the first step that is not yet done.
#
# Log: C:\ProgramData\test-rig\setup.log (appended to, one transcript per
# boot). The same lines reach the serial console and Cloud Logging.
#
# Pinned: Node, Git, and Google's driver script (which itself pins the driver
# release and its SHA-256), each checked against a SHA-256 before it runs.
# Not pinnable: Chrome, whose enterprise installer URL only ever serves the
# current stable release (its Authenticode signature is checked instead, and
# the version installed is logged); OpenSSH Server, which is the one Windows
# ships.

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest's progress bar slows downloads many times over in
# Windows PowerShell 5.1.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = 'C:\ProgramData\test-rig'
$Marker = Join-Path $Root 'setup-complete'
$Downloads = Join-Path $Root 'downloads'
New-Item -ItemType Directory -Force -Path $Root, $Downloads | Out-Null
Start-Transcript -Path (Join-Path $Root 'setup.log') -Append | Out-Null

# Write-Host, not Write-Output: the transcript records it, and it never leaks
# into a function's return value.
function Log([string]$Message) {
  Write-Host "$(Get-Date -Format o) $Message"
}

function Get-Verified([string]$Url, [string]$Name, [string]$Sha256) {
  $path = Join-Path $Downloads $Name
  if (-not (Test-Path $path) -or (Get-FileHash $path -Algorithm SHA256).Hash -ne $Sha256) {
    Log "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $path -UseBasicParsing
  }
  $actual = (Get-FileHash $path -Algorithm SHA256).Hash
  if ($actual -ne $Sha256) {
    Remove-Item $path -Force
    throw "SHA-256 mismatch for ${Name}: expected $Sha256, got $actual"
  }
  return $path
}

function Invoke-Installer([string]$File, [string[]]$Arguments, [string]$Name) {
  Log "Running the $Name installer"
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -Wait -PassThru
  # 3010: success, restart required. The set-up restarts once at the end.
  if ($process.ExitCode -notin 0, 3010) {
    throw "$Name installer exited with $($process.ExitCode)"
  }
}

function Install-Msi([string]$Path, [string]$Name) {
  $msiLog = Join-Path $Root "$Name-msi.log"
  Invoke-Installer 'msiexec.exe' @('/i', "`"$Path`"", '/qn', '/norestart', '/l*v', "`"$msiLog`"") $Name
}

# Native tools write progress to stderr, which Windows PowerShell 5.1 turns
# into terminating errors under 'Stop'.
function Invoke-Native([string]$File, [string[]]$Arguments) {
  $saved = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $File @Arguments 2>&1 | ForEach-Object { Log "  $_" }
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $saved
  }
}

function Update-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
    [Environment]::GetEnvironmentVariable('Path', 'User')
}

$restart = $false
try {
  if (Test-Path $Marker) {
    Log "Set-up finished on $(Get-Content $Marker); nothing to do."
    return
  }
  Log 'Set-up starting.'

  # --- OpenSSH Server ---------------------------------------------------------
  # Windows Server 2025 ships it installed and disabled; google-compute-engine-ssh
  # (installed at first-boot specialisation, see instance.tf) lets the guest
  # agent answer for the keys `gcloud compute ssh` pushes.
  if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
    Log 'Adding the OpenSSH Server capability'
    Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null
  }
  Set-Service sshd -StartupType Automatic
  if ((Get-Service sshd).Status -ne 'Running') { Start-Service sshd }
  if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' `
      -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
  }
  # Keys only: `gcloud compute reset-windows-password` makes password accounts,
  # and they should get in over Remote Desktop, not SSH. sshd keeps the first
  # value it reads, so the line goes at the very top of the file, ahead of the
  # `Match` block Windows' default configuration ends with. sshd writes that
  # file on its first start, above.
  $sshdConfig = 'C:\ProgramData\ssh\sshd_config'
  $sshdExe = "$env:WINDIR\System32\OpenSSH\sshd.exe"
  $lines = @(Get-Content $sshdConfig)
  if ($lines[0] -ne 'PasswordAuthentication no') {
    Log 'SSH: key only'
    Copy-Item $sshdConfig "$sshdConfig.before-test-rig" -Force
    Set-Content -Path $sshdConfig -Value (@('PasswordAuthentication no') + $lines) -Encoding ascii
    if ((Invoke-Native $sshdExe @('-t')) -ne 0) {
      Copy-Item "$sshdConfig.before-test-rig" $sshdConfig -Force
      throw 'sshd rejected the configuration with password login off; the previous one is back.'
    }
    Restart-Service sshd
  }
  Log "OpenSSH Server: $((Get-Item $sshdExe).VersionInfo.ProductVersion), running, key login only"

  # --- NVIDIA driver ----------------------------------------------------------
  # Google's documented method for Windows GPU machines: its install script,
  # here at a fixed commit. That commit installs the 582.53 driver from
  # Google's bucket and checks the installer's SHA-256 itself.
  $smiPaths = @("$env:WINDIR\System32\nvidia-smi.exe", 'C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe')
  $smi = $smiPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $smi) {
    $driverScript = Get-Verified `
      'https://raw.githubusercontent.com/GoogleCloudPlatform/compute-gpu-installation/e4d32d90993a17795b9f6bc411d2ae6d767052ca/windows/install_gpu_driver.ps1' `
      'install_gpu_driver.ps1' '9d3eb7064a19aaf8e043c6eb863a490054105f0c7f8f121cdab76b100a092897'
    Log 'Running Google''s NVIDIA driver script'
    $code = Invoke-Native 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $driverScript)
    if ($code -ne 0) { throw "Google's NVIDIA driver script exited with $code" }
    $smi = $smiPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $smi) { throw 'The NVIDIA driver script finished but nvidia-smi is not installed.' }
  }
  Invoke-Native $smi @() | Out-Null
  # The driver version and the licence it runs under (see README.md, "The first
  # run's probe").
  & $smi -q 2>&1 | Where-Object { $_ -match 'Driver Version|Licensed Product|Product Name|License Status' } |
    ForEach-Object { Log "  $($_.ToString().Trim())" }

  # --- Chrome (stable) --------------------------------------------------------
  $chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
  if (-not (Test-Path $chrome)) {
    $msi = Join-Path $Downloads 'googlechromestandaloneenterprise64.msi'
    Log 'Downloading Chrome (current stable)'
    Invoke-WebRequest -Uri 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi' `
      -OutFile $msi -UseBasicParsing
    $signature = Get-AuthenticodeSignature $msi
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|, )O=Google LLC(,|$)') {
      throw "Chrome installer signature is $($signature.Status), signed by '$($signature.SignerCertificate.Subject)'"
    }
    Install-Msi $msi 'chrome'
  }
  Log "Chrome: $((Get-Item $chrome).VersionInfo.ProductVersion)"

  # --- Hold the machine still ---------------------------------------------------
  # A measurement compares builds on one machine, so neither Chrome nor Windows
  # may change or restart it between runs. Google's updater ignores its update
  # policies on a machine outside a domain, so its tasks and services are
  # switched off instead; Windows Update honours its policy. Both are undone by
  # deleting the machine, which is how a new Chrome or a Windows patch arrives.
  Get-ScheduledTask | Where-Object { $_.TaskName -like 'GoogleUpdate*' } | ForEach-Object {
    Disable-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath | Out-Null
    Log "Disabled scheduled task $($_.TaskPath)$($_.TaskName)"
  }
  Get-Service | Where-Object { $_.Name -like 'GoogleUpdater*' -or $_.Name -in 'gupdate', 'gupdatem' } | ForEach-Object {
    Stop-Service $_.Name -Force -ErrorAction SilentlyContinue
    Set-Service $_.Name -StartupType Disabled
    Log "Disabled service $($_.Name)"
  }
  $au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
  New-Item -Path $au -Force | Out-Null
  Set-ItemProperty -Path $au -Name NoAutoUpdate -Value 1 -Type DWord
  Log 'Windows Update: automatic updates off (policy NoAutoUpdate=1)'

  # --- Node 22 ----------------------------------------------------------------
  $nodeVersion = '22.23.3'
  $node = 'C:\Program Files\nodejs\node.exe'
  if (-not (Test-Path $node) -or (Get-Item $node).VersionInfo.ProductVersion -ne $nodeVersion) {
    $msi = Get-Verified "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-x64.msi" "node-v$nodeVersion-x64.msi" `
      '1c0efc8449987e7da5d184786a0a96da83ffa11d334421201e5c09b93017cb8d'
    Install-Msi $msi 'node'
  }
  Log "Node: $((Get-Item $node).VersionInfo.ProductVersion)"

  # --- Git with LFS -----------------------------------------------------------
  # Git for Windows installs Git LFS with its default components.
  $git = 'C:\Program Files\Git\cmd\git.exe'
  if (-not (Test-Path $git)) {
    $installer = Get-Verified 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/Git-2.55.0.5-64-bit.exe' `
      'Git-2.55.0.5-64-bit.exe' 'd065a4e23c3d9a6b5073d609b5be0830227ec3ca053c083ba385061ddfaf94c6'
    Invoke-Installer $installer @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/SUPPRESSMSGBOXES') 'git'
  }
  Update-Path
  if ((Invoke-Native $git @('lfs', 'install', '--system')) -ne 0) { throw 'git lfs install failed' }
  Invoke-Native $git @('--version') | Out-Null
  Invoke-Native $git @('lfs', 'version') | Out-Null

  # --- Done -------------------------------------------------------------------
  Get-CimInstance Win32_VideoController | ForEach-Object {
    Log "Display adapter: $($_.Name), driver $($_.DriverVersion)"
  }
  Set-Content -Path $Marker -Value (Get-Date -Format o)
  Log 'Set-up finished. Restarting once so the display driver starts cleanly.'
  $restart = $true
} catch {
  Log "Set-up FAILED: $_"
  Log 'The next boot retries from the first step that is not yet done.'
  exit 1
} finally {
  Stop-Transcript | Out-Null
}

if ($restart) { Restart-Computer -Force }
