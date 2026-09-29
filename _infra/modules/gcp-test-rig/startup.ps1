# The machine's start-up script, passed in the instance metadata as
# windows-startup-script-ps1 (instance.tf) and run by Google's guest agent,
# through Task Scheduler, as the local system account at EVERY boot.
# Terraform's templatefile fills in the desktop user's name and whether the
# check after set-up requires the RTX Virtual Workstation licence.
#
# Every boot, first:
#   - C:\ProgramData\test-rig made writable by SYSTEM and Administrators only.
# First boot, then never again (marker C:\ProgramData\test-rig\setup-complete):
#   - SSH: the OpenSSH server running, key login only;
#   - the desktop user, its password (made here), automatic logon, and a
#     logon task that sets its console to 1920 x 1080 (a script file the
#     user may read and run but not change);
#   - the NVIDIA RTX Virtual Workstation driver (restarting in between if its
#     installer asks, and checking nvidia-smi after), Chrome, Node 22, Git
#     with LFS;
#   - holds the machine still between measurements; blocks the metadata
#     server (and so the machine's service account) for the desktop user;
#     disables Windows Remote Management's inbound firewall rules;
#   - restarts once.
# A boot whose desktop user has no `done-user-<name>` marker (a new
#   desktop_user, or an image whose marker was removed; README.md):
#   - that user and a new password, then a restart.
# The boot after that (until marker `verified` exists):
#   - checks, with things that can fail, that the driver runs as a licensed
#     RTX Virtual Workstation (on a -vws GPU), that the desktop user is logged
#     on at the console, that its metadata-server block is in place, that no
#     inbound rule admits Windows Remote Management, and
#     that it cannot change the display task's script; logs
#     the console's size and warns if it is not 1920 x 1080. Only then
#     `verified`.
# A boot that fails logs "FAILED: <reason>" and restarts the machine (after
# waiting, at most 15 minutes, for Windows Installer to be idle), which
# retries from the first step not yet done, at most twice in a row.
#
# The machine's run limit and its daily stop are Compute Engine's (instance.tf),
# outside Windows: nothing here can fail in a way that keeps it running.
#
# Each first-boot step records its own marker, so a boot that fails part-way
# is finished by the next one from the first step not yet done. Every
# download, installer, native program and service start or stop has a time
# limit; one that runs over is stopped and logged as "Timed out: ...". Log: C:\ProgramData\test-rig\setup.log. Nothing
# secret is ever written to it.
#
# Written for Windows PowerShell 5.1, which is what the guest agent runs.
# Terraform's templatefile reads a dollar sign followed by a brace as its own,
# so the script never writes one except for its two values.
# tests/startup.test.mjs checks that, and Windows' limits on what the script
# passes to Windows, without PowerShell.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$DesktopUser = '${desktop_user}'
$RequireVws = '${require_vws}' -eq '1'
# New-LocalUser takes a description of at most 48 characters.
$DesktopUserDescription = 'Logs on by itself; runs the browser under test'

# Pinned downloads and their SHA-256. The driver is the one Google's own
# Windows installer script (compute-gpu-installation, windows/
# install_gpu_driver.ps1) installs on a virtual-workstation machine: NVIDIA's
# 582.53 RTX Virtual Workstation driver (vGPU 19, the long-term branch), from
# Google's bucket, with the SHA-256 that script pins.
$DriverUrl = 'https://storage.googleapis.com/compute-gpu-installation-us/windows/582.53_grid_win10_win11_server2022_server_2025_dch_64bit_international.exe'
$DriverSha256 = '6F1210B459EFC7F29DB930103533C3DE9B93C2AFDFA8D7B4871640C6B8638C0B'
$NodeVersion = '22.23.3'
$NodeSha256 = '1C0EFC8449987E7DA5D184786A0A96DA83FFA11D334421201E5C09B93017CB8D'
$GitUrl = 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/Git-2.55.0.5-64-bit.exe'
$GitSha256 = 'D065A4E23C3D9A6B5073D609B5BE0830227EC3CA053C083BA385061DDFAF94C6'

$Root = Join-Path $env:ProgramData 'test-rig'
$Downloads = Join-Path $Root 'downloads'
$PasswordFile = Join-Path $Root 'desktop-password'
$MetadataRule = 'test-rig-block-metadata'
$RemoteManagementPorts = @('5985', '5986')
$UserStep = "user-$DesktopUser"
$FailureCount = Join-Path $Root 'failed-boots'
# The console's size. With no monitor, Windows starts the console at whatever
# mode the display driver offers first; the desktop user's logon task below
# asks for this one.
$DisplayWidth = 1920
$DisplayHeight = 1080
$DisplayTask = 'test-rig-display'
$DisplayDir = Join-Path $env:ProgramData 'test-rig-display'
$DisplayScript = Join-Path $DisplayDir 'set-display.ps1'
$MaxFailureRestarts = 2

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

function Get-Verified([string]$Url, [string]$Sha256, [int]$Minutes = 15) {
  $path = Join-Path $Downloads ([IO.Path]::GetFileName($Url))
  if (-not (Test-Path $path) -or (Get-FileHash $path -Algorithm SHA256).Hash -ne $Sha256) {
    Log "Downloading $Url (at most $Minutes minutes)"
    Invoke-Timed "the download of $Url" $Minutes $WebDownload @($Url, $path)
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
    Invoke-Taskkill $process.Id
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
function Install-Msi([string]$Path, [string]$Name, [int]$Minutes, [string]$Installed) {
  Wait-InstallerIdle 30
  $msiLog = Join-Path $Root "$Name-msi.log"
  $code = Invoke-Installer 'msiexec.exe' @('/i', "`"$Path`"", '/qn', '/norestart', '/l*v', "`"$msiLog`"") $Name $Minutes -Msi
  # 3010: success, restart required. The set-up restarts once at the end.
  if ($code -notin 0, 3010) { throw "$Name installer exited with $code" }
  if (-not (Test-Path $Installed)) { throw "$Name installer exited with $code, but $Installed is not there" }
}

# One argument as a Windows command line takes it: quoted when it holds a
# space or a quote, with the quotes and the backslashes before them escaped.
function ConvertTo-Argument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + (($Value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

# Runs a native program, stops it (and everything it started) after $Seconds,
# and returns its exit code and its output lines (standard output, then
# standard error). Its output goes to files, not to PowerShell, so a program
# writing progress to stderr never becomes an error under 'Stop'.
function Invoke-Bounded([string]$File, [string[]]$Arguments, [int]$Seconds) {
  $out = [IO.Path]::GetTempFileName()
  $err = [IO.Path]::GetTempFileName()
  try {
    $line = (@($Arguments) | ForEach-Object { ConvertTo-Argument $_ }) -join ' '
    $start = @{ FilePath = $File; NoNewWindow = $true; PassThru = $true; RedirectStandardOutput = $out; RedirectStandardError = $err }
    if ($line) { $start.ArgumentList = $line }
    $process = Start-Process @start
    # Holding the handle keeps ExitCode readable once the process has gone.
    $null = $process.Handle
    if (-not $process.WaitForExit($Seconds * 1000)) {
      Invoke-Taskkill $process.Id
      throw "Timed out: $([IO.Path]::GetFileName($File)) $line did not finish in $Seconds seconds; stopped it"
    }
    $lines = @(Get-Content $out, $err -ErrorAction SilentlyContinue | ForEach-Object { "$_" })
    return @{ Code = $process.ExitCode; Lines = $lines }
  } finally {
    Remove-Item $out, $err -Force -ErrorAction SilentlyContinue
  }
}

# Stops a process and everything it started. taskkill.exe itself is not given
# a limit: it only signals.
function Invoke-Taskkill([int]$ProcessId) {
  $kill = Start-Process -FilePath "$env:WINDIR\System32\taskkill.exe" -ArgumentList "/PID $ProcessId /T /F" -NoNewWindow -PassThru
  $null = $kill.WaitForExit(60000)
}

# A native program, its output logged, its exit code returned. Five minutes
# unless the caller says otherwise.
function Invoke-Native([string]$File, [string[]]$Arguments, [int]$Seconds = 300) {
  $result = Invoke-Bounded $File $Arguments $Seconds
  foreach ($line in $result.Lines) { Log "  $line" }
  return $result.Code
}

# The same, returning the output lines.
function Get-NativeLines([string]$File, [string[]]$Arguments, [int]$Seconds = 300) {
  return (Invoke-Bounded $File $Arguments $Seconds).Lines
}

function Find-Smi {
  $candidates = @("$env:WINDIR\System32\nvidia-smi.exe", "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe") +
    @(Get-ChildItem "$env:WINDIR\System32\DriverStore\FileRepository\nv*\nvidia-smi.exe" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  return $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

# The driver version and the licensed product from `nvidia-smi -q`. The
# product is under "vGPU Software Licensed Product"; the GPU's own "Product
# Name" line comes earlier and is not it. Google: on a properly licensed
# machine the product is "NVIDIA RTX Virtual Workstation" and the status
# "Licensed (Expiry: Permanent)"; any other output (its example: "NVIDIA
# Virtual Applications", "Licensed (Expiry: N/A)", on a GPU attached without
# the workstation licence) means no GPU acceleration.
function Get-LicenceState([string[]]$Lines) {
  $state = @{ Driver = ''; Product = ''; Status = ''; Ok = $false }
  $inLicensed = $false
  foreach ($line in $Lines) {
    if ($line -match '^\s*Driver Version\s*:\s*(.+?)\s*$') { $state.Driver = $Matches[1] }
    if ($line -match 'vGPU Software Licensed Product') { $inLicensed = $true; continue }
    if ($inLicensed -and $line -match '^\s*Product Name\s*:\s*(.+?)\s*$') { $state.Product = $Matches[1] }
    if ($inLicensed -and $line -match '^\s*License Status\s*:\s*(.+?)\s*$') { $state.Status = $Matches[1]; $inLicensed = $false }
  }
  $state.Ok = $state.Product -ceq 'NVIDIA RTX Virtual Workstation' -and $state.Status -match '^Licensed'
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

# Sets the display mode of the session it runs in, by Microsoft's documented
# ChangeDisplaySettingsEx, saved for that user (CDS_UPDATEREGISTRY), and says
# what the mode was and what Windows answered (0: done; -2: the driver offers
# no such mode). DEVMODEW as Microsoft declares it, display fields.
$DisplaySource = @"
using System;
using System.Runtime.InteropServices;
namespace TestRig {
  public static class Display {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DEVMODE {
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
      public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
      public int dmFields;
      public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
      public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
      public short dmLogPixels;
      public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
      public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string device, int mode, ref DEVMODE dm);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string device, ref DEVMODE dm, IntPtr hwnd, int flags, IntPtr param);
    public static string Set(int width, int height) {
      DEVMODE dm = new DEVMODE();
      dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
      if (!EnumDisplaySettings(null, -1, ref dm)) return "the current mode cannot be read";
      string before = dm.dmPelsWidth + "x" + dm.dmPelsHeight + " at " + dm.dmDisplayFrequency + " Hz";
      if (dm.dmPelsWidth == width && dm.dmPelsHeight == height) return "already " + before;
      dm.dmPelsWidth = width;
      dm.dmPelsHeight = height;
      dm.dmFields = 0x80000 | 0x100000;
      int result = ChangeDisplaySettingsEx(null, ref dm, IntPtr.Zero, 0x01, IntPtr.Zero);
      return "was " + before + "; ChangeDisplaySettingsEx to " + width + "x" + height + " returned " + result;
    }
  }
}
"@

# A task that runs at every logon of the desktop user, in that user's session
# (the interactive logon type needs no password), and asks for the console's
# size. The script it runs is a file in its own directory, which SYSTEM and
# Administrators may change and the desktop user may only read and run; the
# directory is made afresh each time, so a former desktop user keeps no
# access. The task writes what happened to the user's own local application
# data, where the check after set-up reads it.
function Set-DisplayTask {
  $lines = @(
    '$ErrorActionPreference = ''Stop'''
    '$out = Join-Path $env:LOCALAPPDATA ''test-rig-display.txt'''
    'try {'
    '  Add-Type -TypeDefinition @'''
    $DisplaySource
    '''@'
    "  `$result = [TestRig.Display]::Set($DisplayWidth, $DisplayHeight)"
    '} catch { $result = "failed: $_" }'
    'Set-Content -Path $out -Value "$(Get-Date -Format o) $result"'
  )
  $sid = (Get-LocalUser -Name $DesktopUser).SID.Value
  Remove-Item $DisplayDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $DisplayDir | Out-Null
  $code = Invoke-Native 'icacls.exe' @($DisplayDir, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', "*$($sid):(OI)(CI)RX")
  if ($code -ne 0) { throw "icacls could not restrict $DisplayDir ($code)" }
  Set-Content -Path $DisplayScript -Value ($lines -join "`r`n") -Encoding ascii
  $action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$DisplayScript`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:COMPUTERNAME\$DesktopUser"
  $principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$DesktopUser" -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $DisplayTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Log "Display: task $DisplayTask runs $DisplayScript at every logon of $DesktopUser, asking for $DisplayWidth x $DisplayHeight"
}

# The display script's access, as the check after set-up requires it: SYSTEM
# and Administrators, and the desktop user with no right to change it (to
# write, append, delete, or change its permissions or owner), nobody else, and
# not owned by the desktop user.
function Test-DisplayScriptAccess {
  if (-not (Test-Path $DisplayScript)) { throw "The display script $DisplayScript is not there" }
  $sid = (Get-LocalUser -Name $DesktopUser).SID.Value
  $acl = Get-Acl $DisplayScript
  $change = [Security.AccessControl.FileSystemRights]'Write, Delete, ChangePermissions, TakeOwnership'
  foreach ($rule in $acl.Access) {
    $who = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($who -notin 'S-1-5-18', 'S-1-5-32-544', $sid) { throw "$DisplayScript is open to $who ($($rule.FileSystemRights))" }
    if ($who -eq $sid -and $rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $change) -ne 0) {
      throw "$DesktopUser may change $DisplayScript ($($rule.FileSystemRights))"
    }
  }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid) { throw "$DesktopUser owns $DisplayScript" }
  Log "Display script: $DisplayScript, SYSTEM and Administrators full, $DesktopUser read and run only"
}

# 24 characters from 57 letters and digits (no 0, O, 1, I or l), about 140
# bits, with at least one capital, one small letter and one digit: three of
# the four classes Windows' complexity rule asks for, and never containing
# the account's name, which the rule also refuses. Bytes of 228 and over are
# skipped, so every character is equally likely.
function New-Password([string]$UserName) {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  do {
    $bytes = New-Object byte[] 64
    $rng.GetBytes($bytes)
    $chars = foreach ($b in $bytes) { if ($b -lt 228) { $alphabet[$b % 57] } }
    $candidate = -join ($chars | Select-Object -First 24)
  } until ($candidate.Length -eq 24 -and $candidate -cmatch '[A-Z]' -and $candidate -cmatch '[a-z]' -and $candidate -match '[0-9]' -and $candidate.IndexOf($UserName, [StringComparison]::OrdinalIgnoreCase) -lt 0)
  return $candidate
}

# SYSTEM and Administrators only, with nothing inherited from ProgramData
# (whose Users may create files): nobody else may plant or swap a download
# between its hash check and its run as SYSTEM, forge a marker, or read the
# desktop password. Everything already inside is reset to inherit this and
# handed to Administrators.
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

# The path of the executable a service runs, from its command line.
function Get-ServiceExe([string]$Name) {
  $service = Get-CimInstance Win32_Service -Filter "Name='$Name'"
  if (-not $service) { return $null }
  if ($service.PathName -match '^\s*"([^"]+)"') { return $Matches[1] }
  return ($service.PathName -split '\s+')[0]
}

function Set-SshKeyOnly {
  # Google's google-compute-engine-ssh package (installed at first-boot
  # specialisation, instance.tf) installs its own OpenSSH server and answers
  # for the keys `gcloud compute ssh` pushes. If no sshd service exists, the
  # Windows capability is added instead.
  if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
    Log 'Adding the OpenSSH Server capability (at most 20 minutes)'
    Invoke-Timed 'adding the OpenSSH Server capability' 20 { Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null } @()
  }
  Set-Service sshd -StartupType Automatic
  if ((Get-Service sshd).Status -ne 'Running') { Invoke-Timed 'starting sshd' 5 { Start-Service sshd } @() }
  # Keys only: `gcloud compute reset-windows-password` makes password accounts,
  # and they should get in over Remote Desktop, not SSH. sshd keeps the first
  # value it reads, so the line goes at the very top of the file, ahead of the
  # `Match` block Windows' default configuration ends with. The check uses the
  # sshd.exe the service runs, which may be Google's rather than Windows' own.
  $sshdConfig = Join-Path $env:ProgramData 'ssh\sshd_config'
  $sshdExe = Get-ServiceExe 'sshd'
  if (-not $sshdExe -or -not (Test-Path $sshdExe)) { throw "The sshd service's executable '$sshdExe' is not there" }
  $lines = @(Get-Content $sshdConfig)
  if ($lines[0] -ne 'PasswordAuthentication no') {
    Copy-Item $sshdConfig "$sshdConfig.before-test-rig" -Force
    Set-Content -Path $sshdConfig -Value (@('PasswordAuthentication no') + $lines) -Encoding ascii
    if ((Invoke-Native $sshdExe @('-t', '-f', $sshdConfig)) -ne 0) {
      Copy-Item "$sshdConfig.before-test-rig" $sshdConfig -Force
      throw 'sshd rejected the configuration with password login off; the previous one is back.'
    }
    Invoke-Timed 'restarting sshd' 5 { Restart-Service sshd } @()
  }
  Log "OpenSSH Server: $sshdExe $((Get-Item $sshdExe).VersionInfo.ProductVersion), running, key login only"
  Complete-Step 'ssh'
}

function Set-DesktopUser {
  # A local account outside Administrators, logged on automatically at every
  # boot, so Chrome has a desktop to draw on with nobody connected. Its
  # password is made here and goes to exactly two places: the LSA secret that
  # automatic logon reads, and a file in $Root that only SYSTEM and
  # Administrators may read (for signing in as that user by hand). A rerun
  # makes a new one and replaces both. It never passes through a command line.
  Add-Type -TypeDefinition $LsaSource
  $password = New-Password $DesktopUser
  $secure = ConvertTo-SecureString $password -AsPlainText -Force
  if (Get-LocalUser -Name $DesktopUser -ErrorAction SilentlyContinue) {
    Set-LocalUser -Name $DesktopUser -Password $secure
  } else {
    New-LocalUser -Name $DesktopUser -Password $secure -PasswordNeverExpires -AccountNeverExpires -UserMayNotChangePassword -Description $DesktopUserDescription | Out-Null
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
  # Inherits $Root's SYSTEM-and-Administrators-only access (Protect-Root).
  Set-Content -Path $PasswordFile -Value $password -Encoding ascii -NoNewline
  $password = $null
  $secure = $null
  Log "Desktop user $($DesktopUser): logs on automatically; password made here, kept in $PasswordFile"
  Set-DisplayTask
  Complete-Step $UserStep
}

# The desktop user's processes, a browser among them, may not reach the
# metadata server, and so neither the machine's service account nor anything
# in its metadata. Its address serves HTTP on port 80; the guest agent and the
# start-up script run as the local system account and still can.
function Set-MetadataBlock {
  $sid = (Get-LocalUser -Name $DesktopUser).SID.Value
  Get-NetFirewallRule -Name $MetadataRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -Name $MetadataRule -DisplayName "Block the metadata server for $DesktopUser" -Direction Outbound -Action Block `
    -Protocol TCP -RemoteAddress 169.254.169.254 -RemotePort 80 -LocalUser "D:(A;;CC;;;$sid)" | Out-Null
  Log "Closed: the metadata server is blocked for $DesktopUser"
}

# Ends this boot's set-up early for a restart that a step needs; the main part
# restarts the machine and the next boot goes on from the next step.
function Request-Restart([string]$Reason) {
  $script:RestartReason = $Reason
  Log "Restart needed: $Reason"
}

# Whether a firewall rule's local ports, as Get-NetFirewallPortFilter gives
# them (numbers, ranges such as 5000-6000, or keywords such as Any), name a
# port of Windows Remote Management. Any is not counted: a rule for every port
# is not a Remote Management rule, and the VPC admits only 22 and 3389.
function Test-RemoteManagementPort([string[]]$Ports) {
  foreach ($port in $Ports) {
    foreach ($wanted in $RemoteManagementPorts) {
      if ($port -eq $wanted) { return $true }
      if ($port -match '^(\d+)-(\d+)$' -and [int]$Matches[1] -le [int]$wanted -and [int]$wanted -le [int]$Matches[2]) { return $true }
    }
  }
  return $false
}

# The enabled inbound rules that admit Windows Remote Management (HTTP 5985,
# HTTPS 5986): its own firewall group, and any other rule on its ports, which
# Google's instance set-up (it configures WinRM over HTTPS at specialisation)
# may add outside that group.
function Get-OpenRemoteManagementRules {
  return @(Get-NetFirewallRule -Direction Inbound -Enabled True -ErrorAction SilentlyContinue | Where-Object {
      $_.Action -eq 'Allow' -and ($_.DisplayGroup -like 'Windows Remote Management*' -or (Test-RemoteManagementPort @(($_ | Get-NetFirewallPortFilter).LocalPort)))
    })
}

# Closed on the host as well: nothing reaches Windows Remote Management through
# the VPC (no external address; IAP's range only, to 22 and 3389), and with its
# inbound rules disabled one mistaken VPC rule would expose it no more. Its
# service is left running; nothing but the firewall is changed.
function Close-RemoteManagement {
  $open = @(Get-OpenRemoteManagementRules)
  $open | Disable-NetFirewallRule
  $listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in '0.0.0.0', '::' } |
    ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" } | Sort-Object -Unique
  Log "Closed: Windows Remote Management's inbound rules disabled ($(if ($open.Count) { ($open | ForEach-Object { $_.DisplayName }) -join ', ' } else { 'none were enabled' })). Still listening on all addresses, behind the host firewall and the VPC: $($listening -join ' ')"
}

function Install-Everything {
  if (-not (Test-Step 'ssh')) { Set-SshKeyOnly }
  if (-not (Test-Step $UserStep)) { Set-DesktopUser }

  # --- NVIDIA RTX Virtual Workstation driver ----------------------------------
  # Google's documented method: the vWS driver from Google's bucket, the build
  # Google's own installer script picks for a virtual-workstation machine,
  # checked here against its SHA-256 and its Authenticode signature. NVIDIA's
  # installer switches: -s silent, -n no restart; exit code 0 is success, 1 is
  # "Success, but reboot required", any other value is failure. On 1 the
  # machine restarts before anything checks the driver, and the next boot
  # checks it; on 0 it is checked at once. A driver that is not ready yet
  # (nvidia-smi missing or failing) is given one restart, shared with the
  # installer's own request, before the step fails. The licence check on the
  # boot after set-up is the second line.
  if (-not (Test-Step 'driver')) {
    if (-not (Test-Step 'driver-installed')) {
      $exe = Get-Verified $DriverUrl $DriverSha256 30
      Assert-Signer $exe 'NVIDIA Corporation'
      $code = Invoke-Installer $exe @('-s', '-n', "-log:$Root\nvidia-install", '-loglevel:6') 'NVIDIA driver' 30
      if ($code -notin 0, 1) { throw "The NVIDIA driver installer failed with exit code $code (0 and 1 are success); its log is in $Root\nvidia-install" }
      Complete-Step 'driver-installed'
      if ($code -eq 1) { Complete-Step 'driver-restarted'; Request-Restart 'the NVIDIA driver installer asked for a restart (exit code 1)'; return }
    }
    $smi = Find-Smi
    $code = if ($smi) { Invoke-Native $smi @() 120 } else { 'not found' }
    if ($code -ne 0) {
      if (-not (Test-Step 'driver-restarted')) {
        Complete-Step 'driver-restarted'
        Request-Restart "nvidia-smi is not ready after the driver install ($code); one restart before it counts as a failure"
        return
      }
      throw "nvidia-smi ($smi) is not ready after the driver install and a restart: $code"
    }
    Log "nvidia-smi: $smi"
    Complete-Step 'driver'
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
      $service = $_.Name
      try { Invoke-Timed "stopping $service" 5 { param($Name) Stop-Service $Name -Force } @($service) } catch { Log "Not stopped now, disabled from the next boot: $_" }
      Set-Service $service -StartupType Disabled
      Log "Disabled service $service"
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

  if (-not (Test-Step 'closed')) {
    Set-MetadataBlock
    Close-RemoteManagement
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
    if ($licence.Ok -or -not $RequireVws) { break }
    Start-Sleep -Seconds 15
  } while ((Get-Date) -lt $deadline)
  Log "NVIDIA driver $($licence.Driver); licensed product '$($licence.Product)'; licence '$($licence.Status)'"
  if ($RequireVws -and -not $licence.Ok) { throw 'The driver is not running as a licensed NVIDIA RTX Virtual Workstation' }
  if (-not $RequireVws) { Log 'A GPU without the workstation licence (a control run): the licence is logged, not required' }

  # The desktop user logged on at the console, not in a Remote Desktop session.
  $deadline = (Get-Date).AddMinutes(3)
  do {
    $sessions = Get-NativeLines "$env:WINDIR\System32\qwinsta.exe" @()
    $console = @($sessions | Where-Object { $_ -match "^\s*>?console\s+$([regex]::Escape($DesktopUser))\s+\d+\s+Active" })
    if ($console.Count -gt 0) { break }
    Start-Sleep -Seconds 10
  } while ((Get-Date) -lt $deadline)
  Log "Sessions: $(($sessions | ForEach-Object { $_.Trim() }) -join ' | ')"
  if ($console.Count -eq 0) { throw "$DesktopUser is not logged on at the console: automatic logon did not take effect" }

  Test-DisplayScriptAccess

  # The console's size: what the logon task did, then what Windows reports.
  # Not a failure: the probe answers whether Chrome gets the GPU at any size;
  # a size other than the one asked for is recorded and warned about.
  $asked = Join-Path $env:SystemDrive "Users\$DesktopUser\AppData\Local\test-rig-display.txt"
  $deadline = (Get-Date).AddMinutes(2)
  while (-not (Test-Path $asked) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 10 }
  if (Test-Path $asked) { Log "Display task: $(Get-Content $asked -TotalCount 1)" } else { Log "WARNING: the display task left no result in $asked" }
  $adapters = @(Get-CimInstance Win32_VideoController)
  foreach ($adapter in $adapters) {
    Log "Display: $($adapter.CurrentHorizontalResolution)x$($adapter.CurrentVerticalResolution) at $($adapter.CurrentRefreshRate) Hz on $($adapter.Name), driver $($adapter.DriverVersion)"
  }
  if (-not ($adapters | Where-Object { $_.CurrentHorizontalResolution -eq $DisplayWidth -and $_.CurrentVerticalResolution -eq $DisplayHeight })) {
    Log "WARNING: no display is at $DisplayWidth x $DisplayHeight (above): frame times would be measured at another size. README.md, The display."
  }

  $rule = Get-NetFirewallRule -Name $MetadataRule -ErrorAction SilentlyContinue
  if (-not $rule -or $rule.Enabled -ne 'True' -or $rule.Action -ne 'Block') { throw "No enabled rule blocks the metadata server for $DesktopUser" }
  $open = @(Get-OpenRemoteManagementRules)
  if ($open.Count -gt 0) { throw "Windows Remote Management is open on the host: $(($open | ForEach-Object { $_.DisplayName }) -join ', ')" }
  $listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in '0.0.0.0', '::' } |
    ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" } | Sort-Object -Unique
  Log "Closed: metadata server blocked for $DesktopUser; no inbound rule for Windows Remote Management. Listening on all addresses (the VPC firewall admits only IAP, to 22 and 3389): $($listening -join ' ')"
}

$restart = $false
$failed = $false
$script:RestartReason = $null
try {
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  Start-Transcript -Path (Join-Path $Root 'setup.log') -Append | Out-Null
  Protect-Root
  if (-not (Test-Path (Join-Path $Root 'setup-complete'))) {
    Log 'Set-up starting.'
    Install-Everything
    if ($script:RestartReason) {
      Log 'Restarting; the next boot goes on from the next step.'
    } else {
      Set-Content -Path (Join-Path $Root 'setup-complete') -Value (Get-Date -Format o)
      Log 'Set-up finished. Restarting once; the next boot checks it.'
    }
    $restart = $true
  } elseif (-not (Test-Step $UserStep)) {
    # A new desktop_user, or a machine started from an image whose user
    # marker was removed (README.md): the user and a new password, its
    # metadata block, then a restart so that automatic logon uses them. The
    # machine stops being ready first, so that a failure here can never
    # leave it marked ready with the new user unchecked.
    Remove-Item (Join-Path $Root 'verified') -ErrorAction SilentlyContinue
    Set-DesktopUser
    Set-MetadataBlock
    Log 'Desktop user set. Restarting once; the next boot checks it.'
    $restart = $true
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
  $failed = $true
  Log "FAILED: $_"
  # A failure restarts the machine, which retries from the first step not yet
  # done, at most $MaxFailureRestarts times in a row: a step that fails for a
  # passing reason (a download, a driver not yet loaded) is retried without
  # anyone there, and one that fails every time does not restart forever.
  #
  # An MSI whose time limit ran out may still be installing inside the
  # Windows Installer service (only its msiexec client was stopped). A
  # restart now would cut it off, and the next boot would meet a suspended
  # install. So the restart first waits up to 15 minutes for Windows Installer
  # to be idle; one still busy after its own limit and those 15 minutes is
  # taken as hung, and the restart goes ahead (Windows Installer rolls an
  # unfinished install back at the restart, and the retry installs again).
  try {
    $count = 0
    if (Test-Path $FailureCount) { $count = [int](Get-Content $FailureCount -TotalCount 1) }
    if ($count -lt $MaxFailureRestarts) {
      Set-Content -Path $FailureCount -Value ($count + 1)
      try { Wait-InstallerIdle 15 } catch { Log "$_; restarting all the same" }
      Log "Restarting to retry from the first step not yet done (automatic restart $($count + 1) of $MaxFailureRestarts)."
      $restart = $true
    } else {
      Log "The last $MaxFailureRestarts boots failed too: no automatic restart left. Read the FAILED line above; after a fix, restart the machine by hand to retry from the first step not yet done."
    }
  } catch {
    Log "The count of automatic restarts cannot be read or written ($_): no automatic restart."
  }
} finally {
  if (-not $failed) { Remove-Item $FailureCount -Force -ErrorAction SilentlyContinue }
  try { Stop-Transcript | Out-Null } catch { }
}

if ($restart) { Restart-Computer -Force }
if ($failed) { exit 1 }
