# Chrome for the frame budget on the rented Windows machine: one scheduled task, run as the desktop
# user `hiker` with an interactive logon (a service session, session 0, gets no GPU), with the
# debugging port 9222 open for the harness to attach to through a forwarded port. Nothing of vite or
# signaling: the page measured is a preview channel's. Run as the local administrator, through
# Run Command or a Session Manager shell:
#
#   aws ssm send-command --region us-east-1 --instance-ids <instance id> \
#     --document-name AWS-RunPowerShellScript \
#     --parameters "$(jq -Rs '{commands: [.]}' tools/frame-budget/rig/start-chrome.ps1)"
$ErrorActionPreference = 'Stop'

$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$profileDir = 'C:\Users\hiker\frame-budget-profile'
$taskName = 'frame-budget-chrome'

# Any earlier task and any Chrome first, so the port and the profile are free.
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$arguments = "--remote-debugging-port=9222 --user-data-dir=$profileDir --no-first-run --no-default-browser-check --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-gpu-vsync --disable-frame-rate-limit --enable-webgpu-developer-features --start-maximized about:blank"

$action = New-ScheduledTaskAction -Execute $chrome -Argument $arguments
$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\hiker" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Start-Sleep -Seconds 8
try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9222/json/version).Content } catch { Write-Output "no answer on 9222: $_" }
try { Get-NetTCPConnection -LocalPort 9222 -State Listen | Format-Table LocalAddress, LocalPort, OwningProcess } catch { Write-Output 'nothing listening on 9222' }
