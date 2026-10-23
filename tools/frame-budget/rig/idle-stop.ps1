# An idle watchdog for a rig: a scheduled task, every minute, that shuts the machine down (and so
# stops it: the instance's shutdown behaviour is `stop`) once Chrome's debugging port has had no
# connection for IdleMinutes in a row. A harness run holds a connection to 9222 the whole time
# (the browser's own socket and each page's), so a machine is stopped only when no harness is on
# it: a forgotten rig costs IdleMinutes, not max_run_hours. Run as the local administrator, through
# Run Command or a Session Manager shell, once per machine (an image keeps it):
#
#   aws ssm send-command --region us-east-1 --instance-ids <instance id> \
#     --document-name AWS-RunPowerShellScript \
#     --parameters "$(jq -Rs '{commands: [.]}' tools/frame-budget/rig/idle-stop.ps1)"
#
# `Unregister-ScheduledTask rig-idle-stop` takes it off again. IdleMinutes is the number below.
$ErrorActionPreference = 'Stop'
$IdleMinutes = 15
$taskName = 'rig-idle-stop'
$dir = 'C:\ProgramData\rig-idle-stop'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# What the task runs: counts the minutes since a connection to 9222 was last seen, in a file, and
# shuts down at the limit. A boot resets the count: a file written before this boot (the count the
# machine was stopped at, or one from before a restart) is read as zero, so a machine the watchdog
# stopped gets its full IdleMinutes again at the next start instead of stopping a minute in.
$check = @"
`$idleMinutes = $IdleMinutes
`$file = '$dir\idle-minutes'
`$busy = @(Get-NetTCPConnection -LocalPort 9222 -State Established -ErrorAction SilentlyContinue).Count -gt 0
if (`$busy) { Set-Content `$file '0'; exit 0 }
`$n = 0
`$booted = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
if ((Test-Path `$file) -and (Get-Item `$file).LastWriteTime -gt `$booted) {
  [int]::TryParse((Get-Content `$file -ErrorAction SilentlyContinue), [ref]`$n) | Out-Null
}
`$n += 1
Set-Content `$file "`$n"
if (`$n -ge `$idleMinutes) {
  Add-Content '$dir\log' "`$(Get-Date -Format o) no connection to 9222 for `$n minutes: shutting down"
  shutdown /s /t 10 /c 'rig idle: no browser client'
}
"@
Set-Content -Path "$dir\check.ps1" -Value $check -Encoding ascii

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $dir\check.ps1"
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$boot = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable
# One task, two triggers: the boot trigger starts the minute checks from a boot without waiting
# for the first minute, and the check itself ignores a count file older than the boot.
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($every, $boot) -Principal $principal -Settings $settings -Force | Out-Null
Remove-Item "$dir\idle-minutes" -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $taskName
"rig-idle-stop: every minute; stops after $IdleMinutes minutes without a connection to 9222"
(Get-ScheduledTask -TaskName $taskName).State
