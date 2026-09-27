# The machine's start-up script, passed as user data (instance.tf) and run by
# EC2Launch v2 as the local system account at EVERY boot, before the Systems
# Manager agent starts. Terraform's templatefile fills in the region, user,
# parameter, timer and display values below and strips the comment lines
# (EC2 caps user data at 16 KB).
#
# Every boot:
#   - arms the stop timer: a scheduled task shuts Windows down max_run_hours
#     after this boot, and the instance's shutdown behaviour is `stop`.
# First boot, then never again (marker C:\ProgramData\test-rig\setup-complete):
#   - the desktop user, its password (made here) and automatic logon;
#   - the NVIDIA GRID driver, Amazon DCV server, Chrome, Node 22, Git with LFS;
#   - holds the machine still between measurements;
#   - exits 3010, which EC2Launch v2 answers by restarting and running this
#     script again.
# A boot from an image whose `done-user` marker was removed (README.md):
#   - a new desktop password, then 3010 again.
# The boot after that (until marker `verified` exists):
#   - checks, with things that can fail, that the driver runs as a licensed
#     virtual workstation, that DCV's console session belongs to the desktop
#     user and that the desktop user is logged on.
#
# Each first-boot step records its own marker, so a boot that fails part-way
# is finished by the next one from the first step not yet done. Log:
# C:\ProgramData\test-rig\setup.log. Nothing secret is ever written to it.
#
# Written for Windows PowerShell 5.1, which is what EC2Launch runs. The user
# data (instance.tf) dot-sources this script and exits with its $exitCode.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Region = '${region}'
$DesktopUser = '${desktop_user}'
$PasswordParameter = '${password_parameter}'
$MaxRunMinutes = ${max_run_minutes}

# Pinned downloads and their SHA-256. The driver is the one AWS's bucket
# serves as `latest` for Windows (GRID 20.2, built for Server 2022 and 2025),
# by its versioned key so it cannot change under this script.
$DriverKey = 'grid-20.2/596.86__grid_win10_win11_server2022_server2025_dch_64bit_international_aws_swl.exe'
$DriverSha256 = 'E847099942F9E17E859FC151E725AEAB9D23639C54D976A651732691B5FCA6A1'
$DcvUrl = 'https://d1uj6qtbmh3dt5.cloudfront.net/2025.0/Servers/nice-dcv-server-x64-Release-2025.0-20103.msi'
$DcvSha256 = '593E2B78CD41B64FAC255F303E48B1E7F73129969279BA2EAE067E519F962067'
$NodeVersion = '22.23.3'
$NodeSha256 = '1C0EFC8449987E7DA5D184786A0A96DA83FFA11D334421201E5C09B93017CB8D'
$GitUrl = 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/Git-2.55.0.5-64-bit.exe'
$GitSha256 = 'D065A4E23C3D9A6B5073D609B5BE0830227EC3CA053C083BA385061DDFAF94C6'

$Root = Join-Path $env:ProgramData 'test-rig'
$Downloads = Join-Path $Root 'downloads'
New-Item -ItemType Directory -Force -Path $Root, $Downloads | Out-Null
Start-Transcript -Path (Join-Path $Root 'setup.log') -Append | Out-Null

# Write-Host, not Write-Output: the transcript records it, and it never leaks
# into a function's return value.
function Log([string]$Message) {
  Write-Host "$(Get-Date -Format o) $Message"
}

function Test-Step([string]$Step) { Test-Path (Join-Path $Root "done-$Step") }

function Complete-Step([string]$Step) {
  Set-Content -Path (Join-Path $Root "done-$Step") -Value (Get-Date -Format o)
  Log "Step done: $Step"
}

function Assert-Hash([string]$Path, [string]$Sha256) {
  $actual = (Get-FileHash $Path -Algorithm SHA256).Hash
  if ($actual -ne $Sha256) {
    Remove-Item $Path -Force
    throw "SHA-256 mismatch for $($Path): expected $Sha256, got $actual"
  }
}

function Get-Verified([string]$Url, [string]$Sha256) {
  $path = Join-Path $Downloads ([IO.Path]::GetFileName($Url))
  if (-not (Test-Path $path) -or (Get-FileHash $path -Algorithm SHA256).Hash -ne $Sha256) {
    Log "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $path -UseBasicParsing
  }
  Assert-Hash $path $Sha256
  return $path
}

# Authenticode signature valid, and the signing certificate's common name and
# organisation both exactly the publisher's name.
function Assert-Signer([string]$Path, [string]$Publisher) {
  $signature = Get-AuthenticodeSignature -FilePath $Path
  $cert = $signature.SignerCertificate
  $cn = if ($cert) { $cert.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } else { '' }
  $org = '(^|, )O="?' + [regex]::Escape($Publisher) + '"?(,|$)'
  if ($signature.Status -ne 'Valid' -or $cn -cne $Publisher -or $cert.Subject -cnotmatch $org) {
    throw "$Path has signature status $($signature.Status), signed by '$($cert.Subject)', not by $Publisher"
  }
  Log "Signature of $([IO.Path]::GetFileName($Path)): valid, $Publisher"
}

function Invoke-Installer([string]$File, [string[]]$Arguments, [string]$Name) {
  Log "Running the $Name installer"
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -Wait -PassThru
  Log "The $Name installer exited with $($process.ExitCode)"
  return $process.ExitCode
}

function Install-Msi([string]$Path, [string]$Name, [string[]]$Properties = @()) {
  $msiLog = Join-Path $Root "$Name-msi.log"
  $code = Invoke-Installer 'msiexec.exe' (@('/i', "`"$Path`"", '/qn', '/norestart', '/l*v', "`"$msiLog`"") + $Properties) $Name
  # 3010: success, restart required. The set-up restarts once at the end.
  if ($code -notin 0, 3010) { throw "$Name installer exited with $code" }
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

# The same, returning the output lines and never throwing on stderr.
function Get-NativeLines([string]$File, [string[]]$Arguments) {
  $saved = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    return @(& $File @Arguments 2>&1 | ForEach-Object { "$_" })
  } finally {
    $ErrorActionPreference = $saved
  }
}

function Find-Smi {
  $candidates = @("$env:WINDIR\System32\nvidia-smi.exe", "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe") +
    @(Get-ChildItem "$env:WINDIR\System32\DriverStore\FileRepository\nv*\nvidia-smi.exe" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  return $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

# The driver version and the licensed product from `nvidia-smi -q`. The
# product is under "vGPU Software Licensed Product"; the GPU's own "Product
# Name" line comes earlier and is not it. AWS: the GRID driver runs in
# "NVIDIA Quadro Virtual Workstation mode", enabled by default; its other mode,
# GRID Virtual Applications, is for Remote Desktop Session Host app hosting.
function Get-LicenceState([string[]]$Lines) {
  $state = @{ Driver = ''; Product = ''; Status = ''; Ok = $false }
  $inLicensed = $false
  foreach ($line in $Lines) {
    if ($line -match '^\s*Driver Version\s*:\s*(.+?)\s*$') { $state.Driver = $Matches[1] }
    if ($line -match 'vGPU Software Licensed Product') { $inLicensed = $true; continue }
    if ($inLicensed -and $line -match '^\s*Product Name\s*:\s*(.+?)\s*$') { $state.Product = $Matches[1] }
    if ($inLicensed -and $line -match '^\s*License Status\s*:\s*(.+?)\s*$') { $state.Status = $Matches[1]; $inLicensed = $false }
  }
  $state.Ok = $state.Product -match 'Virtual Workstation' -and $state.Status -match '^Licensed'
  return $state
}

# Keys only the local system account can use. The password is stored as the
# LSA secret DefaultPassword, which Windows' automatic logon reads, rather
# than in the registry's DefaultPassword value, which is plain text any
# authenticated user can read remotely.
$LsaSource = @"
using System;
using System.Runtime.InteropServices;
namespace TestRig {
  public static class Lsa {
    [StructLayout(LayoutKind.Sequential)] struct UString { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] struct Attributes { public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public uint Attrs; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService; }
    [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr system, ref Attributes attributes, uint access, out IntPtr policy);
    [DllImport("advapi32.dll")] static extern uint LsaStorePrivateData(IntPtr policy, ref UString key, ref UString data);
    [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr policy);
    [DllImport("advapi32.dll")] static extern int LsaNtStatusToWinError(uint status);
    static UString Make(string s) { UString u = new UString(); u.Buffer = Marshal.StringToHGlobalUni(s); u.Length = (ushort)(s.Length * 2); u.MaximumLength = (ushort)(s.Length * 2 + 2); return u; }
    public static void Store(string name, string value) {
      Attributes attributes = new Attributes();
      attributes.Length = Marshal.SizeOf(attributes);
      IntPtr policy;
      uint status = LsaOpenPolicy(IntPtr.Zero, ref attributes, 0x00000020, out policy);
      if (status != 0) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(status));
      UString key = Make(name), data = Make(value);
      try {
        status = LsaStorePrivateData(policy, ref key, ref data);
        if (status != 0) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(status));
      } finally {
        Marshal.ZeroFreeGlobalAllocUnicode(data.Buffer);
        Marshal.FreeHGlobal(key.Buffer);
        LsaClose(policy);
      }
    }
  }
}
"@

# 24 characters from 57 letters and digits (no 0, O, 1, I or l), about 140
# bits, with at least one capital, one small letter and one digit for Windows'
# complexity rule. Bytes of 228 and over are skipped, so every character is
# equally likely.
function New-Password {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  do {
    $bytes = New-Object byte[] 64
    $rng.GetBytes($bytes)
    $chars = foreach ($b in $bytes) { if ($b -lt 228) { $alphabet[$b % 57] } }
    $candidate = -join ($chars | Select-Object -First 24)
  } until ($candidate.Length -eq 24 -and $candidate -cmatch '[A-Z]' -and $candidate -cmatch '[a-z]' -and $candidate -match '[0-9]')
  return $candidate
}

function Set-DcvParameter([string]$Key, [string]$Name, $Value, [Microsoft.Win32.RegistryValueKind]$Kind) {
  # .NET rather than the registry provider: DCV key names contain '/', which
  # PowerShell's provider would read as a path separator.
  $k = [Microsoft.Win32.Registry]::Users.CreateSubKey("S-1-5-18\Software\GSettings\com\nicesoftware\dcv\$Key")
  $k.SetValue($Name, $Value, $Kind)
  $k.Close()
}

# A scheduled task, run as the local system account, shuts Windows down
# max_run_hours from now; with the instance's shutdown behaviour at `stop`, the
# machine stops. Re-registered at every boot, so the clock starts again with
# each start. If it cannot be registered, a pending shutdown is the fallback.
function Set-StopTimer {
  $at = (Get-Date).AddMinutes($MaxRunMinutes)
  try {
    $action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\shutdown.exe" -Argument '/s /f /t 0 /d p:0:0 /c "max_run_hours reached"'
    $trigger = New-ScheduledTaskTrigger -Once -At $at
    $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName 'test-rig-stop' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    $next = (Get-ScheduledTaskInfo -TaskName 'test-rig-stop').NextRunTime
    if (-not $next) { throw 'the task has no next run time' }
    Log "Stop timer: Windows shuts down, and the machine stops, at $next"
  } catch {
    Log "Stop timer: the task failed ($_); a pending shutdown instead"
    & "$env:WINDIR\System32\shutdown.exe" /s /f /t ($MaxRunMinutes * 60) /d p:0:0 /c 'max_run_hours reached'
    Log "Stop timer: shutdown.exe exited with $LASTEXITCODE"
  }
}

function Set-DesktopUser {
  # A local account outside Administrators, logged on automatically at every
  # boot, so Chrome has a desktop to draw on with nobody connected. Its
  # password is made here and goes to exactly two places: the LSA secret that
  # automatic logon reads, and Parameter Store (for signing in to DCV). A
  # rerun makes a new one and replaces both.
  Add-Type -TypeDefinition $LsaSource
  $password = New-Password
  $secure = ConvertTo-SecureString $password -AsPlainText -Force
  if (Get-LocalUser -Name $DesktopUser -ErrorAction SilentlyContinue) {
    Set-LocalUser -Name $DesktopUser -Password $secure
  } else {
    New-LocalUser -Name $DesktopUser -Password $secure -PasswordNeverExpires -AccountNeverExpires -UserMayNotChangePassword -Description 'Logs on automatically; runs the browser under test' | Out-Null
  }
  $users = Get-LocalGroup -SID 'S-1-5-32-545'
  if (-not (Get-LocalGroupMember -Group $users | Where-Object { $_.Name -like "*\$DesktopUser" })) {
    Add-LocalGroupMember -Group $users -Member $DesktopUser
  }
  if (Get-LocalGroupMember -Group (Get-LocalGroup -SID 'S-1-5-32-544') | Where-Object { $_.Name -like "*\$DesktopUser" }) {
    throw "$DesktopUser is in Administrators; it must not be"
  }
  [TestRig.Lsa]::Store('DefaultPassword', $password)
  $winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
  Set-ItemProperty $winlogon -Name AutoAdminLogon -Value '1' -Type String
  Set-ItemProperty $winlogon -Name DefaultUserName -Value $DesktopUser -Type String
  Set-ItemProperty $winlogon -Name DefaultDomainName -Value $env:COMPUTERNAME -Type String
  Remove-ItemProperty $winlogon -Name DefaultPassword, AutoLogonCount -ErrorAction SilentlyContinue
  Write-SSMParameter -Name $PasswordParameter -Value $password -Type SecureString -Overwrite $true -Region $Region | Out-Null
  $password = $null
  $secure = $null
  Log "Desktop user $($DesktopUser): logs on automatically; password made here, written to Parameter Store $PasswordParameter"
  Complete-Step 'user'
}

function Install-Everything {
  if (-not (Test-Step 'user')) { Set-DesktopUser }

  # --- NVIDIA GRID driver -----------------------------------------------------
  # AWS's documented method for Windows G instances: the installer from the
  # ec2-windows-nvidia-drivers bucket, read with the AWS Tools for PowerShell
  # that AWS's Windows images carry.
  if (-not (Test-Step 'driver')) {
    $exe = Join-Path $Downloads ([IO.Path]::GetFileName($DriverKey))
    if (-not (Test-Path $exe) -or (Get-FileHash $exe -Algorithm SHA256).Hash -ne $DriverSha256) {
      Log "Downloading s3://ec2-windows-nvidia-drivers/$DriverKey"
      Read-S3Object -BucketName 'ec2-windows-nvidia-drivers' -Key $DriverKey -File $exe -Region 'us-east-1' | Out-Null
    }
    Assert-Hash $exe $DriverSha256
    Assert-Signer $exe 'NVIDIA Corporation'
    $code = Invoke-Installer $exe @('-s', '-noreboot') 'NVIDIA GRID driver'
    if (-not (Find-Smi)) { throw "nvidia-smi is missing after the driver installer exited with $code" }
    Complete-Step 'driver'
  }

  # --- Amazon DCV server ------------------------------------------------------
  # Its console session belongs to the desktop user and exists whether or not
  # anyone is connected. It listens on the loopback addresses only, reached
  # through Session Manager's port forwarding. It does not lock the desktop
  # when a client disconnects (os-auto-lock is on by default), and it adds no
  # firewall rule and no virtual display adapter of its own beside the GPU's.
  if (-not (Test-Step 'dcv')) {
    $msi = Get-Verified $DcvUrl $DcvSha256
    Assert-Signer $msi 'Amazon Web Services, Inc.'
    Install-Msi $msi 'dcv' @("AUTOMATIC_SESSION_OWNER=$DesktopUser", 'DISABLE_FIREWALL=1', 'REMOVE=iddDriver')
    Set-DcvParameter 'connectivity' 'web-listen-endpoints' "['127.0.0.1:8443', '[::1]:8443']" String
    Set-DcvParameter 'connectivity' 'enable-quic-frontend' 0 DWord
    Set-DcvParameter 'security' 'os-auto-lock' 0 DWord
    Set-DcvParameter 'session-management' 'create-session' 1 DWord
    Set-DcvParameter 'session-management/automatic-console-session' 'owner' $DesktopUser String
    Set-DcvParameter 'display' 'console-session-default-layout' "[{'w':<${display_width}>, 'h':<${display_height}>, 'x':<0>, 'y':<0>}]" String
    Complete-Step 'dcv'
  }

  # --- Chrome (stable) --------------------------------------------------------
  # Not pinnable: Google's enterprise installer URL only serves the current
  # release. Its signature is checked instead, and its version logged.
  $chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
  if (-not (Test-Path $chrome)) {
    $msi = Join-Path $Downloads 'googlechromestandaloneenterprise64.msi'
    Log 'Downloading Chrome (current stable)'
    Invoke-WebRequest -Uri 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi' -OutFile $msi -UseBasicParsing
    Assert-Signer $msi 'Google LLC'
    Install-Msi $msi 'chrome'
  }
  Log "Chrome: $((Get-Item $chrome).VersionInfo.ProductVersion)"

  # --- Node 22 ------------------------------------------------------------------
  $node = "$env:ProgramFiles\nodejs\node.exe"
  if (-not (Test-Path $node) -or (Get-Item $node).VersionInfo.ProductVersion -ne $NodeVersion) {
    Install-Msi (Get-Verified "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-x64.msi" $NodeSha256) 'node'
  }
  Log "Node: $((Get-Item $node).VersionInfo.ProductVersion)"

  # --- Git with LFS -------------------------------------------------------------
  # Git for Windows installs Git LFS with its default components.
  $git = "$env:ProgramFiles\Git\cmd\git.exe"
  if (-not (Test-Path $git)) {
    $code = Invoke-Installer (Get-Verified $GitUrl $GitSha256) @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/SUPPRESSMSGBOXES') 'git'
    if ($code -ne 0) { throw "git installer exited with $code" }
  }
  if ((Invoke-Native $git @('lfs', 'install', '--system')) -ne 0) { throw 'git lfs install failed' }
  Invoke-Native $git @('lfs', 'version') | Out-Null

  # --- Hold the machine still -------------------------------------------------
  # A measurement compares builds on one machine, so nothing may change it or
  # interrupt it between runs. Google's updater ignores its update policies on
  # a machine outside a domain, so its tasks and services are switched off.
  # Automatic Windows updates are off by policy: this machine runs only while
  # it is measured, so a pause for the length of a run would be the same
  # thing. That stops security updates too; README.md gives the cadence for
  # patching it by hand.
  if (-not (Test-Step 'hold')) {
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
    Set-ItemProperty $au -Name NoAutoUpdate -Value 1 -Type DWord
    Set-ItemProperty $au -Name NoAutoRebootWithLoggedOnUsers -Value 1 -Type DWord
    # The display never sleeps, the machine never sleeps, and the session never
    # locks for inactivity. The screen saver is off by policy in the default
    # user profile, which the desktop user's profile is made from at its first
    # logon (after this boot).
    foreach ($setting in 'monitor-timeout-ac', 'standby-timeout-ac', 'hibernate-timeout-ac') {
      Invoke-Native 'powercfg.exe' @('/change', $setting, '0') | Out-Null
    }
    Invoke-Native 'powercfg.exe' @('/hibernate', 'off') | Out-Null
    Set-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name InactivityTimeoutSecs -Value 0 -Type DWord
    # No full-screen privacy questions over the desktop at the first logon.
    $oobe = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\OOBE'
    New-Item -Path $oobe -Force | Out-Null
    Set-ItemProperty $oobe -Name DisablePrivacyExperience -Value 1 -Type DWord
    $hive = 'HKU\TestRigDefaultUser'
    if ((Invoke-Native 'reg.exe' @('load', $hive, "$env:SystemDrive\Users\Default\NTUSER.DAT")) -ne 0) { throw 'Could not load the default user profile' }
    try {
      foreach ($value in 'ScreenSaveActive', 'ScreenSaverIsSecure') {
        $code = Invoke-Native 'reg.exe' @('add', "$hive\Software\Policies\Microsoft\Windows\Control Panel\Desktop", '/v', $value, '/t', 'REG_SZ', '/d', '0', '/f')
        if ($code -ne 0) { throw "Could not set $value in the default user profile" }
      }
    } finally {
      [GC]::Collect()
      Invoke-Native 'reg.exe' @('unload', $hive) | Out-Null
    }
    Log 'Held still: Chrome updater off, automatic Windows updates off, no sleep, no screen saver, no idle lock'
    Complete-Step 'hold'
  }
}

# Runs on the boot after set-up: every check here can fail, and a failure is
# logged and retried at the next boot.
function Test-Setup {
  $smi = Find-Smi
  if (-not $smi) { throw 'nvidia-smi is not installed' }
  $deadline = (Get-Date).AddMinutes(5)
  do {
    $licence = Get-LicenceState (Get-NativeLines $smi @('-q'))
    if ($licence.Ok) { break }
    Start-Sleep -Seconds 15
  } while ((Get-Date) -lt $deadline)
  Log "NVIDIA driver $($licence.Driver); licensed product '$($licence.Product)'; licence '$($licence.Status)'"
  if (-not $licence.Ok) { throw 'The GRID driver is not running as a licensed virtual workstation' }

  Get-CimInstance Win32_VideoController | ForEach-Object {
    Log "Display adapter: $($_.Name), $($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution) at $($_.CurrentRefreshRate) Hz, driver $($_.DriverVersion)"
  }

  $dcv = "$env:ProgramFiles\NICE\DCV\Server\bin\dcv.exe"
  $deadline = (Get-Date).AddMinutes(3)
  do {
    $sessions = (Get-NativeLines $dcv @('list-sessions')) -join ' '
    $ours = $sessions -match 'console' -and $sessions -match [regex]::Escape($DesktopUser)
    if ($ours) { break }
    Start-Sleep -Seconds 10
  } while ((Get-Date) -lt $deadline)
  Log "DCV: $sessions"
  if (-not $ours) { throw "DCV has no console session owned by $DesktopUser" }

  $deadline = (Get-Date).AddMinutes(3)
  do {
    $desktop = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Where-Object {
      (Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User -eq $DesktopUser
    })
    if ($desktop.Count -gt 0) { break }
    Start-Sleep -Seconds 10
  } while ((Get-Date) -lt $deadline)
  if ($desktop.Count -eq 0) { throw "$DesktopUser is not logged on: automatic logon did not take effect" }
  Log "Desktop: $DesktopUser is logged on, in session $($desktop[0].SessionId)"
}

$exitCode = 0
try {
  Set-StopTimer
  if (-not (Test-Path (Join-Path $Root 'setup-complete'))) {
    Log 'Set-up starting.'
    Install-Everything
    Set-Content -Path (Join-Path $Root 'setup-complete') -Value (Get-Date -Format o)
    Log 'Set-up finished. Restarting once; the next boot checks it.'
    $exitCode = 3010
  } elseif (-not (Test-Step 'user')) {
    # A machine started from an image whose user marker was removed before
    # Sysprep (README.md): a new password, then a restart so that automatic
    # logon uses it.
    Set-DesktopUser
    $exitCode = 3010
  } elseif (-not (Test-Path (Join-Path $Root 'verified'))) {
    Test-Setup
    Set-Content -Path (Join-Path $Root 'verified') -Value (Get-Date -Format o)
    Log 'Set-up checked: the machine is ready.'
  } else {
    $smi = Find-Smi
    if ($smi) {
      $licence = Get-LicenceState (Get-NativeLines $smi @('-q'))
      Log "Boot: NVIDIA driver $($licence.Driver); licensed product '$($licence.Product)'; licence '$($licence.Status)'"
    }
  }
} catch {
  Log "FAILED: $_"
  Log 'The next boot retries from the first step not yet done.'
  $exitCode = 1
} finally {
  Stop-Transcript | Out-Null
}
# The user data that runs this script exits with $exitCode.
