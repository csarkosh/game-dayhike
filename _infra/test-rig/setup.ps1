# The machine's start-up script, passed as user data (instance.tf) and run by
# EC2Launch v2 as the local system account at EVERY boot, after EC2Launch has
# started the Systems Manager agent (so a Session Manager shell can follow this
# log while it runs). Terraform's templatefile fills in the region, user,
# parameter and display values below and strips the comment lines (EC2 caps
# user data at 16 KB).
#
# Every boot, first, before anything else can fail (even opening the log):
#   - the stop timer: a scheduled task shuts Windows down max-run-minutes (an
#     instance tag) after the boot, and the instance's shutdown behaviour is
#     `stop`. It is registered afresh at every boot with a one-time trigger for
#     that boot and a start-up trigger delayed by the same amount, which fires
#     at later boots even if this script does not run; if it cannot be set, a
#     pending shutdown is;
# then:
#   - C:\ProgramData\test-rig made writable by SYSTEM and Administrators only.
# First boot, then never again (marker C:\ProgramData\test-rig\setup-complete):
#   - the desktop user, its password (made here) and automatic logon;
#   - the NVIDIA GRID driver, Amazon DCV server, Chrome, Node 22, Git with LFS;
#   - holds the machine still between measurements; closes Remote Desktop and
#     Windows Remote Management on the host, and the metadata service to the
#     desktop user;
#   - exits 3010, which EC2Launch v2 answers by restarting and running this
#     script again.
# A boot from an image whose `done-user` marker was removed (README.md):
#   - a new desktop password, then 3010 again.
# The boot after that (until marker `verified` exists):
#   - checks, with things that can fail, that the driver runs as a licensed
#     virtual workstation, that DCV's console session belongs to the desktop
#     user, that the desktop user is logged on, that Remote Desktop and its and
#     Windows Remote Management's firewall rules are off, and that the desktop
#     user's metadata-service block is in place. Only then `verified`.
#
# Each first-boot step records its own marker, so a boot that fails part-way
# is finished by the next one from the first step not yet done. Every download
# and every installer has a time limit; one that runs over is stopped and
# logged as "Timed out: ...". Log: C:\ProgramData\test-rig\setup.log. Nothing
# secret is ever written to it.
#
# Written for Windows PowerShell 5.1, which is what EC2Launch runs. The user
# data (instance.tf) dot-sources this script and exits with its $exitCode.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Region = '${region}'
$DesktopUser = '${desktop_user}'
$PasswordParameter = '${password_parameter}'
# Used only if the instance tag max-run-minutes cannot be read.
$DefaultMaxRunMinutes = 240

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

$ClosedGroups = @('Remote Desktop', 'Windows Remote Management')
$DcvFirewallRule = 'NICE DCV Server (In)'
$Root = Join-Path $env:ProgramData 'test-rig'
$Downloads = Join-Path $Root 'downloads'
$ShutdownExe = "$env:WINDIR\System32\shutdown.exe"
# Present for one boot: the stop task is left exactly as it is, not even
# re-registered, so that whatever it had when this boot started is what stops
# the machine (README.md, the timer check, which removes its one-time trigger
# by hand before the restart).
$SkipTimerOnce = Join-Path $Root 'skip-stop-timer-once'
$script:Transcribing = $false
$script:EarlyLog = New-Object System.Collections.Generic.List[string]
$script:StopFallback = $false

# Write-Host, not Write-Output: the transcript records it, and it never leaks
# into a function's return value. Lines written before the log file is open
# (the stop timer's) are kept and copied into it once it is.
function Log([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  if (-not $script:Transcribing) { $script:EarlyLog.Add($line) }
  Write-Host $line
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

# Runs $Block in a separate process and stops it after $Minutes: a download
# that stalls becomes a logged failure instead of a set-up that never ends.
function Invoke-Timed([string]$What, [int]$Minutes, [scriptblock]$Block, [object[]]$Arguments) {
  $job = Start-Job -ScriptBlock $Block -ArgumentList $Arguments
  try {
    if (-not (Wait-Job $job -Timeout ($Minutes * 60))) {
      Stop-Job $job
      throw "Timed out: $What did not finish in $Minutes minutes; stopped it"
    }
    if ($job.State -ne 'Completed') {
      throw "$What failed: $($job.ChildJobs[0].JobStateInfo.Reason.Message)"
    }
    Receive-Job $job -ErrorAction Stop | Out-Null
  } finally {
    Remove-Job $job -Force
  }
}

$WebDownload = {
  param($Url, $Path)
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing -TimeoutSec 120
}

$S3Download = {
  param($Bucket, $Key, $Path)
  $ErrorActionPreference = 'Stop'
  Read-S3Object -BucketName $Bucket -Key $Key -File $Path -Region 'us-east-1' | Out-Null
}

function Get-Verified([string]$Url, [string]$Sha256) {
  $path = Join-Path $Downloads ([IO.Path]::GetFileName($Url))
  if (-not (Test-Path $path) -or (Get-FileHash $path -Algorithm SHA256).Hash -ne $Sha256) {
    Log "Downloading $Url (at most 15 minutes)"
    Invoke-Timed "the download of $Url" 15 $WebDownload @($Url, $path)
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

# Runs an installer and stops it, with everything it started, after $Minutes.
# For an MSI that is only msiexec's client: the install itself runs in the
# Windows Installer service, which goes on with it; the message says so.
function Invoke-Installer([string]$File, [string[]]$Arguments, [string]$Name, [int]$Minutes, [switch]$Msi) {
  Log "Running the $Name installer (at most $Minutes minutes)"
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
  # Holding the handle keeps ExitCode readable once the process has gone.
  $null = $process.Handle
  if (-not $process.WaitForExit($Minutes * 60000)) {
    & "$env:WINDIR\System32\taskkill.exe" /PID $process.Id /T /F 2>&1 | Out-Null
    if ($Msi) {
      throw "Timed out: the $Name installer did not finish in $Minutes minutes; its msiexec client was stopped, but Windows Installer may still be installing it. Nothing further runs on this boot; the next boot waits for Windows Installer and tries again"
    }
    throw "Timed out: the $Name installer did not finish in $Minutes minutes; stopped it"
  }
  Log "The $Name installer exited with $($process.ExitCode)"
  return $process.ExitCode
}

# Windows Installer runs one install at a time and holds the Global\_MSIExecute
# mutex while it does. Waits for it to be free, so a new install never starts
# on top of one left running by a timed-out client.
function Wait-InstallerIdle([int]$Minutes) {
  $deadline = (Get-Date).AddMinutes($Minutes)
  while ($true) {
    $mutex = $null
    if (-not [Threading.Mutex]::TryOpenExisting('Global\_MSIExecute', [ref]$mutex)) { return }
    $mutex.Dispose()
    if ((Get-Date) -gt $deadline) { throw "Timed out: Windows Installer was still busy with another install after $Minutes minutes" }
    Start-Sleep -Seconds 10
  }
}

# Installs an MSI and then checks for the product itself ($Installed, a file
# it installs), never trusting the exit code alone.
function Install-Msi([string]$Path, [string]$Name, [int]$Minutes, [string]$Installed, [string[]]$Properties = @()) {
  Wait-InstallerIdle 30
  $msiLog = Join-Path $Root "$Name-msi.log"
  # A log from an earlier attempt is kept beside the new one, not overwritten.
  if (Test-Path $msiLog) { Move-Item $msiLog (Join-Path $Root "$Name-msi.$(Get-Date -Format yyyyMMddTHHmmss).log") -Force }
  $code = Invoke-Installer 'msiexec.exe' (@('/i', "`"$Path`"", '/qn', '/norestart', '/l*v', "`"$msiLog`"") + $Properties) $Name $Minutes -Msi
  # 3010: success, restart required. The set-up restarts once at the end.
  if ($code -notin 0, 3010) { throw "$Name installer exited with $code" }
  if (-not (Test-Path $Installed)) { throw "$Name installer exited with $code, but $Installed is not there" }
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

# Windows' password complexity rule (Passfilt.dll): characters from three of
# the classes (here capitals, small letters and digits, all three), and not
# containing the account name, compared without case, when the name is three
# characters or more. Letters and digits only, so nothing in it is special to
# PowerShell, to a command line or to DCV's sign-in; at most 127 characters
# (New-LocalUser's limit).
function Test-PasswordAcceptable([string]$Candidate, [string]$AccountName) {
  return $Candidate.Length -eq 24 -and $Candidate -cmatch '[A-Z]' -and $Candidate -cmatch '[a-z]' -and
    $Candidate -match '[0-9]' -and $Candidate -cnotmatch '[^A-Za-z0-9]' -and
    ($AccountName.Length -lt 3 -or $Candidate.IndexOf($AccountName, [StringComparison]::OrdinalIgnoreCase) -lt 0)
}

# 24 characters from 57 letters and digits (no 0, O, 1, I or l), about 140
# bits, drawn until Test-PasswordAcceptable passes. Bytes of 228 and over are
# skipped, so every character is equally likely.
function New-Password([string]$AccountName) {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  do {
    $bytes = New-Object byte[] 64
    $rng.GetBytes($bytes)
    $chars = foreach ($b in $bytes) { if ($b -lt 228) { $alphabet[$b % 57] } }
    $candidate = -join ($chars | Select-Object -First 24)
  } until (Test-PasswordAcceptable $candidate $AccountName)
  return $candidate
}

function Set-DcvParameter([string]$Key, [string]$Name, $Value, [Microsoft.Win32.RegistryValueKind]$Kind) {
  # .NET rather than the registry provider: DCV key names contain '/', which
  # PowerShell's provider would read as a path separator.
  $k = [Microsoft.Win32.Registry]::Users.CreateSubKey("S-1-5-18\Software\GSettings\com\nicesoftware\dcv\$Key")
  $k.SetValue($Name, $Value, $Kind)
  $k.Close()
}

# SYSTEM and Administrators only, with nothing inherited from ProgramData
# (whose Users may create files): nobody else may plant or swap a download
# between its hash check and its run as SYSTEM, or forge a marker. Everything
# already inside is reset to inherit this and handed to Administrators.
function Protect-Root {
  $code = Invoke-Native 'icacls.exe' @($Root, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
  if ($code -ne 0) { throw "icacls could not restrict $Root ($code)" }
  if (Get-ChildItem -Force $Root) {
    Invoke-Native 'icacls.exe' @("$Root\*", '/reset', '/T', '/C', '/Q') | Out-Null
    Invoke-Native 'icacls.exe' @("$Root\*", '/setowner', '*S-1-5-32-544', '/T', '/C', '/Q') | Out-Null
  }
  $acl = Get-Acl $Root
  $others = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } |
    Where-Object { $_ -notin 'S-1-5-18', 'S-1-5-32-544' })
  if (-not $acl.AreAccessRulesProtected -or $others.Count -gt 0) { throw "$Root is still open to $($others -join ', ')" }
  New-Item -ItemType Directory -Force -Path $Downloads | Out-Null
  Log "$Root`: SYSTEM and Administrators only"
}

# How long after this boot the machine stops: the instance tag max-run-minutes
# (instance.tf), read from the metadata service, which the local system
# account may reach. The default if it cannot be read.
function Get-MaxRunMinutes {
  for ($i = 1; $i -le 3; $i++) {
    try {
      $token = Invoke-RestMethod -Method Put -Uri 'http://169.254.169.254/latest/api/token' -Headers @{ 'X-aws-ec2-metadata-token-ttl-seconds' = '60' } -TimeoutSec 5 -UseBasicParsing
      $value = Invoke-RestMethod -Uri 'http://169.254.169.254/latest/meta-data/tags/instance/max-run-minutes' -Headers @{ 'X-aws-ec2-metadata-token' = "$token" } -TimeoutSec 5 -UseBasicParsing
      return (ConvertTo-StopMinutes "$value")
    } catch {
      $reason = $_
      Start-Sleep -Seconds 5
    }
  }
  Log "Stop timer: could not read the max-run-minutes tag ($reason); using $DefaultMaxRunMinutes"
  return $DefaultMaxRunMinutes
}

function ConvertTo-StopMinutes([string]$Value) {
  $minutes = 0
  if (-not [int]::TryParse($Value.Trim(), [ref]$minutes) -or $minutes -lt 15 -or $minutes -gt 1440) {
    throw "max-run-minutes is '$Value', not a whole number from 15 to 1440"
  }
  return $minutes
}

# The stop task's two triggers: at every start-up, delayed by $Minutes (so it
# needs no re-arming and fires even on a boot where this script does not run),
# and once, $Minutes after this boot (a start-up trigger registered now fires
# only from the next boot). If this boot is already past its limit, a minute
# from now.
function Get-StopPlan([datetime]$BootTime, [int]$Minutes, [datetime]$Now) {
  $once = $BootTime.AddMinutes($Minutes)
  if ($once -le $Now) { $once = $Now.AddMinutes(1) }
  return @{ Delay = [Xml.XmlConvert]::ToString([TimeSpan]::FromMinutes($Minutes)); Once = $once }
}

# At every boot, first, before anything else can fail: the task is
# unregistered and registered again, with the start-up trigger's delay from the
# tag and a one-time trigger for this boot. Registering it afresh at every boot
# means a changed tag takes effect at once, and no one-time trigger from an
# earlier boot is left to stop this one early (the first run's set-up
# restart included). Run as the local system account, logged on or not.
# Nothing here throws: whatever fails, a pending shutdown is the fallback.
function Set-StopTimer {
  $plan = $null
  try {
    if (Test-Path $SkipTimerOnce) {
      Remove-Item $SkipTimerOnce -Force
      $task = Get-ScheduledTask -TaskName 'test-rig-stop' -ErrorAction SilentlyContinue
      if (-not $task) { throw 'skip-stop-timer-once was set, but there is no stop task to leave as it was' }
      $times = @($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskTimeTrigger' -and $_.Enabled })
      Log "Stop timer: left as it was for this boot (skip-stop-timer-once): start-up trigger delay $((Get-BootDelays $task) -join ', '); $($times.Count) one-time trigger(s) $(($times | ForEach-Object { $_.StartBoundary }) -join ', ')"
      return
    }
    $minutes = Get-MaxRunMinutes
    $boot = Get-Date
    try { $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime } catch { Log "Stop timer: the boot time cannot be read ($_); counting from now" }
    $plan = Get-StopPlan $boot $minutes (Get-Date)
    $action = New-ScheduledTaskAction -Execute $ShutdownExe -Argument '/s /f /t 0 /d p:0:0 /c "max_run_hours reached"'
    $atStartup = New-ScheduledTaskTrigger -AtStartup
    $atStartup.Delay = $plan.Delay
    $once = New-ScheduledTaskTrigger -Once -At $plan.Once
    $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    Unregister-ScheduledTask -TaskName 'test-rig-stop' -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName 'test-rig-stop' -Action $action -Trigger @($atStartup, $once) -Principal $principal -Settings $settings | Out-Null
    $task = Get-ScheduledTask -TaskName 'test-rig-stop'
    $next = (Get-ScheduledTaskInfo -TaskName 'test-rig-stop').NextRunTime
    if (@(Get-BootDelays $task) -notcontains $plan.Delay -or -not $next -or $task.State -ne 'Ready') {
      throw "the task reads back as $($task.State), next run '$next', start-up delays '$(@(Get-BootDelays $task) -join ',')', not $($plan.Delay)"
    }
    Log "Stop timer: $minutes minutes after every boot; for this boot at $next"
  } catch {
    Invoke-StopFallback $plan "$_"
  }
}

# A pending `shutdown /s /t <seconds>`, for when the task cannot be set. It
# cannot throw; if even it fails, the log says that only the daily stop from
# outside remains.
function Invoke-StopFallback($Plan, [string]$Reason) {
  try {
    $seconds = 60 * $DefaultMaxRunMinutes
    try { if ($Plan) { $seconds = [int][Math]::Max(60, ($Plan.Once - (Get-Date)).TotalSeconds) } } catch { }
    Log "Stop timer: the task failed ($Reason); a pending shutdown in $seconds s instead"
    $output = & $ShutdownExe /s /f /t $seconds /d p:0:0 /c 'max_run_hours reached' 2>&1
    $script:StopFallback = ($LASTEXITCODE -eq 0)
    Log "Stop timer: shutdown.exe exited with $LASTEXITCODE $output"
  } catch {
    $script:StopFallback = $false
    try { Log "Stop timer: the pending shutdown failed too ($_); only the daily stop from outside remains" } catch { }
  }
}

# A pending shutdown makes Windows refuse any other, the launch agent's restart
# after set-up included. When the fallback is pending and the set-up wants its
# restart, the pending shutdown is swapped for a pending restart a minute away,
# and the script does not ask the launch agent for one. Returns the exit code
# to use. If the restart cannot be set, the shutdown is put back.
function Resolve-RestartWithFallback([int]$ExitCode) {
  if ($ExitCode -ne 3010 -or -not $script:StopFallback) { return $ExitCode }
  try {
    & $ShutdownExe /a 2>&1 | Out-Null
    & $ShutdownExe /r /f /t 60 /d p:0:0 /c 'test-rig set-up restart' 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Log 'Stop timer: the pending shutdown is now a restart in 60 s, for the set-up'
      return 0
    }
    throw "shutdown.exe /r exited with $LASTEXITCODE"
  } catch {
    Invoke-StopFallback $null "the restart could not be set: $_"
    return 0
  }
}

function Get-BootDelays($Task) {
  return @($Task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' -and $_.Enabled } | ForEach-Object { $_.Delay })
}

function Set-DesktopUser {
  # A local account outside Administrators, logged on automatically at every
  # boot, so Chrome has a desktop to draw on with nobody connected. Its
  # password is made here and goes to exactly two places: the LSA secret that
  # automatic logon reads, and Parameter Store (for signing in to DCV). A
  # rerun makes a new one and replaces both.
  Add-Type -TypeDefinition $LsaSource
  $password = New-Password $DesktopUser
  $secure = ConvertTo-SecureString $password -AsPlainText -Force
  if (Get-LocalUser -Name $DesktopUser -ErrorAction SilentlyContinue) {
    Set-LocalUser -Name $DesktopUser -Password $secure
  } else {
    New-LocalUser -Name $DesktopUser -Password $secure -PasswordNeverExpires -AccountNeverExpires -UserMayNotChangePassword -Description 'Logs on automatically; runs the tested browser' | Out-Null
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
      Log "Downloading s3://ec2-windows-nvidia-drivers/$DriverKey (at most 30 minutes)"
      Invoke-Timed 'the NVIDIA driver download' 30 $S3Download @('ec2-windows-nvidia-drivers', $DriverKey, $exe)
    }
    Assert-Hash $exe $DriverSha256
    Assert-Signer $exe 'NVIDIA Corporation'
    # NVIDIA's installation guide: -s silent, -n no restart; exit code 0 is
    # success, 1 is "Success, but reboot required" (the set-up restarts once at
    # the end anyway), any other value is failure. The licence check on the
    # boot after set-up is the second line.
    $code = Invoke-Installer $exe @('-s', '-n', "-log:$Root\nvidia-install", '-loglevel:6') 'NVIDIA GRID driver' 30
    if ($code -notin 0, 1) { throw "The NVIDIA GRID driver installer failed with exit code $code (0 and 1 are success); its log is in $Root\nvidia-install" }
    if (-not (Find-Smi)) { throw "nvidia-smi is missing after the driver installer exited with $code" }
    Complete-Step 'driver'
  }

  # --- Amazon DCV server ------------------------------------------------------
  # Its console session belongs to the desktop user and exists whether or not
  # anyone is connected. It listens on the loopback addresses only, reached
  # through Session Manager's port forwarding. It does not lock the desktop
  # when a client disconnects (os-auto-lock is on by default).
  #
  # Exactly the features it needs, named with ADDLOCAL (the package's own
  # feature names, 2025.0-20103): server (the core, dcv.exe, dcvserver.exe),
  # webClient (the browser client) and VC2017Redist (the Visual C++ runtime the
  # server needs; the package enables that feature only when the runtime is
  # missing, and Windows Installer leaves a disabled feature out). Once any
  # feature is named on the command line, Windows Installer installs nothing
  # else, so no REMOVE: on a first install a REMOVE with no ADDLOCAL names no
  # feature to install, becomes REMOVE=ALL and runs the package's uninstall
  # path. Left out: the indirect display driver (iddDriver; AWS's guide gives
  # it to machines without a GPU driver, and here the GRID driver's display is
  # the one Chrome must draw on), and the audio, printer, webcam, gamepad,
  # smart card, USB, WebAuthn and WebRTC redirection drivers.
  #
  # DISABLE_FIREWALL=0: in this package the action that adds the firewall rule
  # "NICE DCV Server (In)" runs unless DISABLE_FIREWALL is "0" (the value of
  # its own "No, I will manually configure my firewall later" box), whatever
  # the guide says of 1. Any such rule is removed afterwards all the same.
  if (-not (Test-Step 'dcv')) {
    $msi = Get-Verified $DcvUrl $DcvSha256
    Assert-Signer $msi 'Amazon Web Services, Inc.'
    Install-Msi $msi 'dcv' 20 "$env:ProgramFiles\NICE\DCV\Server\bin\dcv.exe" @('ADDLOCAL=server,webClient,VC2017Redist', "AUTOMATIC_SESSION_OWNER=$DesktopUser", 'DISABLE_FIREWALL=0')
    $rules = @(Get-NetFirewallRule -DisplayName $DcvFirewallRule -ErrorAction SilentlyContinue)
    $rules | Remove-NetFirewallRule
    Log "DCV: $($rules.Count) firewall rule(s) '$DcvFirewallRule' removed; iddDriver not installed"
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
  # release. Its signature is checked instead, and its version logged. Each
  # install below is marked done only once its product is in place, so one
  # that timed out is run again, never built on.
  $chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
  if (-not (Test-Step 'chrome')) {
    $msi = Join-Path $Downloads 'googlechromestandaloneenterprise64.msi'
    $url = 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi'
    Log 'Downloading Chrome (current stable, at most 15 minutes)'
    Invoke-Timed 'the Chrome download' 15 $WebDownload @($url, $msi)
    Assert-Signer $msi 'Google LLC'
    Install-Msi $msi 'chrome' 15 $chrome
    Complete-Step 'chrome'
  }
  Log "Chrome: $((Get-Item $chrome).VersionInfo.ProductVersion)"

  # --- Node 22 ------------------------------------------------------------------
  $node = "$env:ProgramFiles\nodejs\node.exe"
  if (-not (Test-Step 'node')) {
    Install-Msi (Get-Verified "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-x64.msi" $NodeSha256) 'node' 10 $node
    if ((Get-Item $node).VersionInfo.ProductVersion -ne $NodeVersion) { throw "node.exe is $((Get-Item $node).VersionInfo.ProductVersion), not $NodeVersion" }
    Complete-Step 'node'
  }
  Log "Node: $((Get-Item $node).VersionInfo.ProductVersion)"

  # --- Git with LFS -------------------------------------------------------------
  # Git for Windows installs Git LFS with its default components.
  $git = "$env:ProgramFiles\Git\cmd\git.exe"
  if (-not (Test-Step 'git')) {
    $code = Invoke-Installer (Get-Verified $GitUrl $GitSha256) @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/SUPPRESSMSGBOXES') 'git' 10
    if ($code -ne 0) { throw "git installer exited with $code" }
    if (-not (Test-Path $git)) { throw "git installer exited with 0, but $git is not there" }
    if ((Invoke-Native $git @('lfs', 'install', '--system')) -ne 0) { throw 'git lfs install failed' }
    Invoke-Native $git @('lfs', 'version') | Out-Null
    Complete-Step 'git'
  }

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

  # --- Closed on the host as well --------------------------------------------
  # Nothing reaches this machine through its security group. So that one
  # mistake there exposes nothing either: Remote Desktop is off and the host
  # firewall's Remote Desktop and Windows Remote Management rules are disabled.
  # DCV (console sessions, its own port on loopback) and Session Manager (the
  # agent's outbound HTTPS) use neither. And the desktop user's processes, a
  # browser among them, may not reach the instance metadata service and so
  # the instance role's credentials; the agents, DCV's licence check and the
  # driver's run as the local system account and still can.
  if (-not (Test-Step 'closed')) {
    Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 1 -Type DWord
    foreach ($group in $ClosedGroups) {
      Get-NetFirewallRule -DisplayGroup $group -ErrorAction SilentlyContinue | Disable-NetFirewallRule
    }
    $sid = (Get-LocalUser -Name $DesktopUser).SID.Value
    Get-NetFirewallRule -Name 'test-rig-block-imds' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -Name 'test-rig-block-imds' -DisplayName "Block the instance metadata service for $DesktopUser" -Direction Outbound -Action Block `
      -Protocol TCP -RemoteAddress 169.254.169.254 -LocalUser "D:(A;;CC;;;$sid)" | Out-Null
    Log "Closed: Remote Desktop off, firewall groups $($ClosedGroups -join ' and ') disabled, metadata service blocked for $DesktopUser"
    Complete-Step 'closed'
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
  if (Get-NetFirewallRule -DisplayName $DcvFirewallRule -ErrorAction SilentlyContinue) { throw "The firewall rule '$DcvFirewallRule' is present" }
  if (Get-ChildItem "$env:ProgramFiles\NICE\DCV\Server" -Recurse -Filter 'AWSIddDriver.dll' -ErrorAction SilentlyContinue) { throw "DCV's indirect display driver is installed" }
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

  if ((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server').fDenyTSConnections -ne 1) { throw 'Remote Desktop is on' }
  foreach ($group in $ClosedGroups) {
    $open = @(Get-NetFirewallRule -DisplayGroup $group -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' })
    if ($open.Count -gt 0) { throw "Firewall rules still enabled in $($group): $($open.DisplayName -join ', ')" }
  }
  $imds = Get-NetFirewallRule -Name 'test-rig-block-imds' -ErrorAction SilentlyContinue
  if (-not $imds -or $imds.Enabled -ne 'True' -or $imds.Action -ne 'Block') { throw "No enabled rule blocks the metadata service for $DesktopUser" }
  $listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in '0.0.0.0', '::' } |
    ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" } | Sort-Object -Unique
  Log "Closed: Remote Desktop off; $($ClosedGroups -join ' and ') rules disabled; metadata blocked for $DesktopUser. Listening on all addresses (the security group admits none): $($listening -join ' ')"
}

$exitCode = 0
Set-StopTimer
try {
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  Start-Transcript -Path (Join-Path $Root 'setup.log') -Append | Out-Null
  $script:Transcribing = $true
  foreach ($line in $script:EarlyLog) { Write-Host $line }
  Protect-Root
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
}
$exitCode = Resolve-RestartWithFallback $exitCode
if ($script:Transcribing) { try { Stop-Transcript | Out-Null } catch { } }
# The user data that runs this script exits with $exitCode.
