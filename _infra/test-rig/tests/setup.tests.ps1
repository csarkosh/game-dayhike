# Checks of setup.ps1 that run without Windows, on PowerShell 7 on any
# operating system:
#
#   pwsh -NoProfile -File _infra/test-rig/tests/setup.tests.ps1
#
# It parses the script (as Terraform leaves it before filling in values), finds
# no syntax Windows PowerShell 5.1 lacks, then loads the script's functions (not
# its main part) and checks those that need no Windows: the licence rule, the
# password, the signer rule, the stop timer's plan and tag, the time limits on
# downloads, and the stop timer's failure paths with a stand-in shutdown.exe.
# Exits 1 on any failure.

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..' 'setup.ps1'
$fail = 0
function Check([string]$Name, [bool]$Condition) {
  if ($Condition) { "ok   $Name" } else { "FAIL $Name"; $script:fail++ }
}

# --- Syntax -------------------------------------------------------------------
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors)
Check 'the script parses' ($errors.Count -eq 0)
$ps7 = $ast.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.TernaryExpressionAst] -or
    $n -is [System.Management.Automation.Language.PipelineChainAst] -or
    ($n -is [System.Management.Automation.Language.BinaryExpressionAst] -and $n.Operator -eq 'QuestionQuestion') -or
    ($n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Operator -eq 'QuestionQuestionEquals') -or
    ($n -is [System.Management.Automation.Language.MemberExpressionAst] -and $n.NullConditional)
  }, $true)
Check 'no syntax that Windows PowerShell 5.1 lacks' ($ps7.Count -eq 0)

# --- Arguments with a documented length limit ------------------------------------
# New-LocalUser and Set-LocalUser: "-Description ... The maximum length is 48
# characters." Every literal passed there must fit.
$userCalls = $ast.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -in 'New-LocalUser', 'Set-LocalUser'
  }, $true)
$descriptions = foreach ($call in $userCalls) {
  $elements = $call.CommandElements
  for ($i = 0; $i -lt $elements.Count - 1; $i++) {
    if ($elements[$i] -is [System.Management.Automation.Language.CommandParameterAst] -and $elements[$i].ParameterName -eq 'Description') {
      $elements[$i + 1]
    }
  }
}
Check 'a -Description is passed to New-LocalUser' (@($descriptions).Count -ge 1)
foreach ($d in $descriptions) {
  Check "-Description is a literal of at most 48 characters: '$($d.Extent.Text)'" (
    $d -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $d.Value.Length -le 48)
}

# Windows Installer: a REMOVE with no ADDLOCAL on a first install names nothing
# to install and runs the package's uninstall path. Every Install-Msi line that
# passes REMOVE= must pass ADDLOCAL= too; every feature named must be one of
# the thirteen in nice-dcv-server-x64-Release-2025.0-20103.msi's Feature table.
$source = Get-Content $script -Raw
$msiLines = @($source -split "`n" | Where-Object { $_ -match 'Install-Msi ' -and $_ -notmatch '^\s*(#|function)' })
Check 'an MSI is installed' ($msiLines.Count -ge 1)
foreach ($line in $msiLines) {
  Check "no REMOVE= without ADDLOCAL=: $($line.Trim())" (-not ($line -match 'REMOVE=' -and $line -notmatch 'ADDLOCAL='))
}
$dcvFeatures = 'ALL', 'server', 'webClient', 'webrtc', 'webauthn', 'VC2017Redist', 'iddDriver', 'webcamDriver',
  'gamepadDriver', 'audioMicDriver', 'audioSpkDriver', 'printerDriver', 'virtualSmartcardDriver', 'usbDriver'
foreach ($m in [regex]::Matches($source, '(?:ADDLOCAL|REMOVE)=([A-Za-z0-9,]+)')) {
  foreach ($name in $m.Groups[1].Value -split ',') {
    Check "feature '$name' is one of the DCV package's" ($name -cin $dcvFeatures)
  }
}

# --- The script's functions and the variables they read -------------------------
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  . ([ScriptBlock]::Create($f.Extent.Text))
}
$DefaultMaxRunMinutes = 240
$script:Transcribing = $true
$script:EarlyLog = New-Object System.Collections.Generic.List[string]
$work = Join-Path ([IO.Path]::GetTempPath()) "setup-tests-$PID"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$SkipTimerOnce = Join-Path $work 'skip-stop-timer-once'
function Log([string]$Message) { $script:Logged += , $Message }

# --- The licence rule -------------------------------------------------------------
$gpu = @('Driver Version                            : 596.86', 'GPU 00000000:00:1E.0', '    Product Name                          : Tesla T4')
$lic = { param($p, $s) $gpu + @('    vGPU Software Licensed Product', "        Product Name                      : $p", "        License Status                    : $s") }
$vws = Get-LicenceState (& $lic 'NVIDIA RTX Virtual Workstation' 'Licensed (Expiry: N/A)')
Check 'a licensed Virtual Workstation passes' ($vws.Ok -and $vws.Driver -eq '596.86')
Check 'Virtual Applications fails' (-not (Get-LicenceState (& $lic 'NVIDIA Virtual Applications' 'Licensed (Expiry: N/A)')).Ok)
Check 'Cloud Gaming fails' (-not (Get-LicenceState (& $lic 'NVIDIA Cloud Gaming' 'Licensed (Expiry: N/A)')).Ok)
Check 'an unlicensed Virtual Workstation fails' (-not (Get-LicenceState (& $lic 'NVIDIA RTX Virtual Workstation' 'Unlicensed (Restricted)')).Ok)
Check "no licence section fails; the GPU's own product name is not taken" ((-not (Get-LicenceState $gpu).Ok) -and (Get-LicenceState $gpu).Product -eq '')

# --- The password -----------------------------------------------------------------
$seen = @{}
$bad = $null
foreach ($i in 1..200) {
  $p = New-Password 'hiker'
  if ($p.Length -ne 24 -or $p -cnotmatch '[A-Z]' -or $p -cnotmatch '[a-z]' -or $p -notmatch '[0-9]' -or $p -cmatch '[^A-HJ-NP-Za-km-z2-9]' -or $p -match 'hiker') { $bad = $p }
  $seen[$p] = 1
}
Check 'passwords: 24 characters, all three classes, the alphabet only, no account name' (-not $bad)
Check 'passwords: 200 distinct' ($seen.Count -eq 200)
Check 'a password holding the account name, in any case, is refused' (-not (Test-PasswordAcceptable 'Ab2xxHiKeRxxxxxxxxxxxxxx' 'hiker'))
Check 'a short account name is not checked' (Test-PasswordAcceptable 'Ab2xxJoxxxxxxxxxxxxxxxxx' 'jo')
Check 'a password missing a class is refused' (-not (Test-PasswordAcceptable 'abcdefghijkmnpqrstuvwxy2' 'hiker'))
Check 'a password with a symbol is refused' (-not (Test-PasswordAcceptable 'Ab2xxxxxxxxxxxxxxxxxxxx$' 'hiker'))
Check 'a password of another length is refused' (-not (Test-PasswordAcceptable 'Ab2' 'hiker'))

# --- The signer rule (the organisation part of Assert-Signer) ----------------------
function OrgOk($Subject, $Publisher) { $Subject -cmatch ('(^|, )O="?' + [regex]::Escape($Publisher) + '"?(,|$)') }
Check 'AWS, quoted O' (OrgOk 'CN="Amazon Web Services, Inc.", O="Amazon Web Services, Inc.", L=Seattle, C=US' 'Amazon Web Services, Inc.')
Check 'NVIDIA' (OrgOk 'CN=NVIDIA Corporation, OU=2008B9F, O=NVIDIA Corporation, C=US' 'NVIDIA Corporation')
Check 'a suffix is refused' (-not (OrgOk 'CN=Google LLC, O=Google LLC Foo, C=US' 'Google LLC'))
Check 'OU is not O' (-not (OrgOk 'CN=x, OU=Google LLC, O=Other, C=US' 'Google LLC'))

# --- The stop timer's plan and tag ---------------------------------------------------
$boot = [datetime]'2026-09-27T10:00:00'
$plan = Get-StopPlan $boot 240 ([datetime]'2026-09-27T10:02:00')
Check '240 minutes is PT4H, 4 h after the boot' ($plan.Delay -eq 'PT4H' -and $plan.Once -eq [datetime]'2026-09-27T14:00:00')
Check '15 minutes is PT15M' ((Get-StopPlan $boot 15 $boot).Delay -eq 'PT15M')
Check '90 minutes is PT1H30M' ((Get-StopPlan $boot 90 $boot).Delay -eq 'PT1H30M')
Check 'a boot past its limit stops a minute from now' ((Get-StopPlan $boot 15 ([datetime]'2026-09-27T10:20:00')).Once -eq [datetime]'2026-09-27T10:21:00')
Check 'tag 240 reads as 240' ((ConvertTo-StopMinutes '240') -eq 240)
Check 'a tag with a newline reads' ((ConvertTo-StopMinutes "90`n") -eq 90)
foreach ($value in '14', '1441', 'abc', '', '4.5', '-1') {
  $threw = $false
  try { ConvertTo-StopMinutes $value | Out-Null } catch { $threw = $true }
  Check "tag '$value' is refused" $threw
}

# --- Time limits on downloads -------------------------------------------------------
$m = ''
try { Invoke-Timed 'a stalled download' 0 { Start-Sleep 30 } @() } catch { $m = "$_" }
Check 'a stalled download is stopped and named' ($m -like 'Timed out: a stalled download did not finish in 0 minutes*')
$m = ''
try { Invoke-Timed 'a broken download' 1 { param($u) throw "404 for $u" } @('x') } catch { $m = "$_" }
Check "a failed download's reason comes through" ($m -like '*404 for x*')
$m = 'none'
try { Invoke-Timed 'a good download' 1 { param($p) Set-Content $p 'ok' } @((Join-Path $work 'ok.txt')) } catch { $m = "$_" }
Check 'a good download passes' ($m -eq 'none' -and (Get-Content (Join-Path $work 'ok.txt')) -eq 'ok')

# --- The stop timer's failure paths ---------------------------------------------------
# No metadata service, no WMI, no Task Scheduler here: the fallback must arm a
# pending shutdown for the whole limit, and nothing may throw.
function Invoke-RestMethod { throw 'no metadata service' }
function Start-Sleep { }
$calls = Join-Path $work 'shutdown-calls.txt'
$fake = Join-Path $work 'shutdown-fake.ps1'
Set-Content $fake "param([Parameter(ValueFromRemainingArguments)]`$a) Add-Content '$calls' (`$a -join ' '); exit 0"
$ShutdownExe = $fake
$script:Logged = @()
$threw = $false
try { Set-StopTimer } catch { $threw = $true }
$made = @(if (Test-Path $calls) { Get-Content $calls })
Check 'with no Task Scheduler, Set-StopTimer does not throw' (-not $threw)
Check 'the fallback is a pending shutdown for the default 240 minutes' ($made.Count -eq 1 -and $made[0] -match '^/s /f /t (\d+) ' -and [int]$Matches[1] -ge 14340 -and [int]$Matches[1] -le 14400)
Check 'the fallback is recorded' ($script:StopFallback -eq $true)
Check 'the unread tag is logged' (@($script:Logged | Where-Object { $_ -like '*could not read the max-run-minutes tag*' }).Count -eq 1)

# The set-up's restart with the fallback pending: the shutdown is swapped for a
# restart, and the launch agent is not asked for one.
Remove-Item $calls
$code = Resolve-RestartWithFallback 3010
$made = @(Get-Content $calls)
Check 'a pending shutdown is swapped for a restart' ($code -eq 0 -and $made.Count -eq 2 -and $made[0] -eq '/a' -and $made[1] -like '/r /f /t 60 *')
$script:StopFallback = $false
Check 'without the fallback, 3010 is left to the launch agent' ((Resolve-RestartWithFallback 3010) -eq 3010)

# Even the fallback failing must not throw.
$ShutdownExe = Join-Path $work 'no-such-shutdown.exe'
$script:Logged = @()
$threw = $false
try { Set-StopTimer } catch { $threw = $true }
Check 'with no shutdown.exe either, Set-StopTimer does not throw' (-not $threw)
Check 'and says only the daily stop remains' (@($script:Logged | Where-Object { $_ -like '*only the daily stop from outside remains*' }).Count -eq 1 -and $script:StopFallback -eq $false)

# The one-boot skip leaves the task alone, is used up, and logs what the task
# holds: here, as after the timer check's step 2, a start-up trigger only.
function Get-ScheduledTask {
  [pscustomobject]@{ Triggers = @(
      [pscustomobject]@{ CimClass = [pscustomobject]@{ CimClassName = 'MSFT_TaskBootTrigger' }; Enabled = $true; Delay = 'PT15M' }
    ) }
}
Set-Content $SkipTimerOnce ''
$ShutdownExe = $fake
Remove-Item $calls -ErrorAction SilentlyContinue
$script:Logged = @()
Set-StopTimer
Check 'skip-stop-timer-once touches nothing and is removed' (-not (Test-Path $SkipTimerOnce) -and -not (Test-Path $calls))
Check 'and logs only what the task holds' (@($script:Logged | Where-Object { $_ -like '*start-up trigger delay PT15M; 0 one-time trigger(s)*' }).Count -eq 1)

# With no task to leave alone, the skip falls back to a pending shutdown.
function Get-ScheduledTask { }
Set-Content $SkipTimerOnce ''
Set-StopTimer
Check 'a skip with no task still arms a pending shutdown' ((Test-Path $calls) -and @(Get-Content $calls)[0] -like '/s /f /t *')

# --- An adapter with no mode ------------------------------------------------------
Check 'an adapter with no mode reads inactive' ((Format-AdapterMode ([pscustomobject]@{ CurrentHorizontalResolution = $null })) -eq 'inactive')
Check 'an active adapter reads its mode' ((Format-AdapterMode ([pscustomobject]@{ CurrentHorizontalResolution = 1920; CurrentVerticalResolution = 1080; CurrentRefreshRate = 60 })) -eq '1920x1080 at 60 Hz')
Remove-Item -Recurse -Force $work
"failures: $fail"
if ($fail -gt 0) { exit 1 }
