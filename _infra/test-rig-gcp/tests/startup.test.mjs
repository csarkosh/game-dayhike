// Checks of startup.ps1 that need neither Windows nor PowerShell:
//
//   node --test _infra/test-rig-gcp/tests/*.test.mjs
//
// The script's first real run is on a rented machine, where a value Windows
// refuses costs a boot. So every literal and default the script hands to
// Windows is checked here against the documented limit of the cmdlet or API it
// goes to, and the script against what Terraform's templatefile and Windows
// PowerShell 5.1 accept.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TASK } from '../probe.mjs';

const dir = new URL('..', import.meta.url);
const script = readFileSync(new URL('startup.ps1', dir), 'utf8');
const variables = readFileSync(new URL('variables.tf', dir), 'utf8');

// The script with its comments and the contents of its strings blanked out
// (each kept as a pair of quotes), so that the checks below read code only.
function code(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const rest = text.slice(i);
    const here = /^@(["'])\r?\n/.exec(rest);
    if (here) {
      const end = text.indexOf(`\n${here[1]}@`, i);
      assert.ok(end > 0, 'a here-string is closed');
      out += '""';
      i = end + 3;
    } else if (rest.startsWith('<#')) {
      i = text.indexOf('#>', i) + 2;
    } else if (text[i] === '#') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (text[i] === "'") {
      i++;
      while (i < text.length && !(text[i] === "'" && text[i + 1] !== "'")) i += text[i] === "'" ? 2 : 1;
      out += "''";
      i++;
    } else if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '`' ? 2 : 1;
      out += '""';
      i++;
    } else {
      out += text[i++];
    }
  }
  return out;
}

// The value of a single-quoted assignment such as $Name = 'value'.
const literal = (name) => {
  const m = new RegExp(`^\\$${name} = '([^']*)'`, 'm').exec(script);
  assert.ok(m, `$${name} is assigned a literal`);
  return m[1];
};
const variableBlock = (name) => {
  const m = new RegExp(`variable "${name}" \\{([\\s\\S]*?)\\n\\}`).exec(variables);
  assert.ok(m, `variable ${name} exists`);
  return m[1];
};

test('the script is a template with exactly two values, and nothing else templatefile would read', () => {
  const found = [...script.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(found)].sort(), ['desktop_user', 'require_vws']);
  assert.equal(script.includes('%{'), false, 'no %{, which templatefile reads as a directive');
  assert.equal(script.includes('$${'), false);
});

test('the script uses no syntax Windows PowerShell 5.1 lacks, and its brackets balance', () => {
  const c = code(script);
  for (const [what, pattern] of [
    ['?? (null-coalescing)', /\?\?/], ['?. (null-conditional)', /\?\./], ['&& or || (chain operators)', /&&|\|\|/],
    ['a ternary', /\s\?\s[^:\n]+\s:\s/], ['ForEach-Object -Parallel', /-Parallel\b/],
  ]) assert.equal(pattern.test(c), false, what);
  const pairs = { ')': '(', '}': '{', ']': '[' };
  const stack = [];
  for (const ch of c) {
    if ('({['.includes(ch)) stack.push(ch);
    else if (ch in pairs) assert.equal(stack.pop(), pairs[ch], `unbalanced ${ch}`);
  }
  assert.deepEqual(stack, []);
});

test('the checker itself sees code, not strings or comments', () => {
  assert.equal(code("$a = 'x ?? y' # z && w\n$b = \"it''s ?.\""), "$a = '' \n$b = \"\"");
  assert.equal(/&&/.test(code('$a = $b && $c')), true);
  assert.equal(code("@'\nx && y\n'@\n$c"), '""\n$c');
});

test('New-LocalUser: the description fits Windows\' 48 characters; the name fits 20', () => {
  // Microsoft (New-LocalUser): "-Description ... The maximum length is 48
  // characters." "-Name ... up to 20 uppercase or lowercase characters".
  assert.match(script, /New-LocalUser -Name \$DesktopUser [^\n]*-Description \$DesktopUserDescription/);
  const description = literal('DesktopUserDescription');
  assert.ok(description.length <= 48, `${description.length} characters: ${description}`);
  assert.equal(/New-LocalUser[^\n]*-FullName/.test(script), false);

  const block = variableBlock('desktop_user');
  const name = new RegExp(/can\(regex\("([^"]+)"/.exec(block)[1].replace(/\\\\/g, '\\'));
  const fallback = /default\s+=\s+"([^"]+)"/.exec(block)[1];
  assert.equal(fallback, 'hiker');
  assert.ok(name.test(fallback));
  assert.ok(name.test('a'.repeat(20)));
  assert.equal(name.test('a'.repeat(21)), false);
  // Characters Windows refuses in a user name: " / \ [ ] : ; | = , + * ? < > @
  for (const bad of ['hi"ker', 'hi/ker', 'hi\\ker', 'hi[ker', 'hi:ker', 'hi;ker', 'hi|ker', 'hi=ker', 'hi,ker', 'hi+ker', 'hi*ker', 'hi?ker', 'hi<ker', 'hi@ker', 'hi ker', 'Hiker']) {
    assert.equal(name.test(bad), false, bad);
  }
});

test('the password meets Windows\' complexity rule and can never contain the user\'s name', () => {
  // Windows' "Password must meet complexity requirements": not the account
  // name, and characters from three of: capitals, small letters, digits,
  // symbols. The policy's default minimum is 6 at most; 24 is well over.
  const alphabet = /\$alphabet = '([^']+)'/.exec(script)[1];
  assert.equal(alphabet.length, 57);
  assert.match(script, /\$alphabet\[\$b % 57\]/);
  assert.match(script, /if \(\$b -lt 228\)/); // 228 = 4 x 57: every character equally likely
  assert.equal(/[^A-Za-z0-9]/.test(alphabet), false);
  assert.equal(/[0O1Il]/.test(alphabet), false);
  assert.ok(/[A-Z]/.test(alphabet) && /[a-z]/.test(alphabet) && /[0-9]/.test(alphabet));
  assert.match(script, /Select-Object -First 24\)/);
  const until = /\} until \((.*)\)\r?\n/.exec(script)[1];
  for (const rule of ["-cmatch '[A-Z]'", "-cmatch '[a-z]'", "-match '[0-9]'", '.Length -eq 24', '.IndexOf($UserName, [StringComparison]::OrdinalIgnoreCase) -lt 0']) {
    assert.ok(until.includes(rule), rule);
  }
  assert.match(script, /New-Password \$DesktopUser/);
});

test('the password never reaches a command line or the log', () => {
  const lines = script.split(/\r?\n/).filter((l) => /\$password\b/.test(l));
  for (const line of lines) {
    assert.equal(/Invoke-Native|Start-Process|& |cmd|net\.exe|net user|Log /.test(line), false, line);
  }
  assert.ok(lines.some((l) => l.includes("[TestRig.Lsa]::Store('DefaultPassword', $password)")));
  assert.ok(lines.some((l) => l.includes('Set-Content -Path $PasswordFile -Value $password')));
});

test('every path the script makes fits Windows\' 260 characters, and names are ones Windows takes', () => {
  // The longest: a download's file name under C:\ProgramData\test-rig\downloads.
  const downloads = 'C:\\ProgramData\\test-rig\\downloads\\';
  const urls = [...script.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1].replace(/\$NodeVersion/g, literal('NodeVersion')));
  assert.ok(urls.length >= 3);
  for (const url of urls) {
    const path = downloads + url.split('/').pop();
    assert.ok(path.length < 260, `${path.length}: ${path}`);
  }
  // Task Scheduler task names are files under System32\Tasks; firewall rule
  // names are free text but kept plain.
  for (const name of [TASK, literal('MetadataRule'), literal('DisplayTask')]) {
    assert.match(name, /^[A-Za-z0-9-]{1,64}$/);
  }
});

test('the pinned downloads carry a full SHA-256, and the driver comes from Google\'s bucket', () => {
  for (const name of ['DriverSha256', 'NodeSha256', 'GitSha256']) assert.match(literal(name), /^[0-9A-F]{64}$/);
  assert.match(literal('DriverUrl'), /^https:\/\/storage\.googleapis\.com\/compute-gpu-installation-us\/windows\/582\.53_grid_[^/]+\.exe$/);
  assert.match(script, /Assert-Signer \$exe 'NVIDIA Corporation'/);
  assert.match(script, /if \(\$code -notin 0, 1\)/);
});

test('the licence rule asks for exactly a licensed NVIDIA RTX Virtual Workstation', () => {
  assert.match(script, /\$state\.Ok = \$state\.Product -ceq 'NVIDIA RTX Virtual Workstation' -and \$state\.Status -match '\^Licensed'/);
  assert.match(script, /if \(\$RequireVws -and -not \$licence\.Ok\) \{ throw/);
});

test('the instance name fits a Windows computer name (15 characters)', () => {
  const block = variableBlock('instance_name');
  const name = new RegExp(/can\(regex\("([^"]+)"/.exec(block)[1].replace(/\\\\/g, '\\'));
  assert.ok(name.test('test-rig'));
  assert.ok(name.test(`a${'b'.repeat(14)}`));
  assert.equal(name.test(`a${'b'.repeat(15)}`), false);
});

test('the script fits Google\'s 256 KB for windows-startup-script-ps1', () => {
  assert.ok(Buffer.byteLength(script) < 200 * 1024);
});

// Lines of code (strings and comments blanked) with their text, for checks of
// what the script calls.
const codeLines = code(script).split('\n');
const scriptLines = script.split('\n');

test('msiexec gets no feature properties: no REMOVE= without ADDLOCAL=, and today none at all', () => {
  // An MSI's REMOVE= on a first install, without ADDLOCAL=, can install
  // nothing of the product (Windows Installer applies REMOVE to the default
  // feature set). This module passes no property to any MSI: a property added
  // later is added here with its reason.
  const allowedProperties = [];
  for (const line of scriptLines) {
    if (/REMOVE=/i.test(line)) assert.match(line, /ADDLOCAL=/i, `REMOVE= without ADDLOCAL=: ${line.trim()}`);
  }
  const msiexec = scriptLines.filter((l) => /Invoke-Installer 'msiexec\.exe'/.test(l));
  assert.equal(msiexec.length, 1, 'one msiexec call, in Install-Msi');
  assert.match(msiexec[0], /Invoke-Installer 'msiexec\.exe' @\('\/i', "`"\$Path`"", '\/qn', '\/norestart', '\/l\*v', "`"\$msiLog`""\) \$Name \$Minutes -Msi/);
  assert.match(script, /^function Install-Msi\(\[string\]\$Path, \[string\]\$Name, \[int\]\$Minutes, \[string\]\$Installed\) \{$/m);
  const calls = codeLines.filter((l) => /\bInstall-Msi\b/.test(l) && !/^function /.test(l.trim()));
  assert.ok(calls.length >= 2);
  const properties = scriptLines.flatMap((l) => [...l.matchAll(/\b([A-Z][A-Z0-9_]{2,})=/g)].map((m) => m[1]));
  assert.deepEqual(properties.filter((p) => !allowedProperties.includes(p)), []);
});

test('the driver step restarts when its installer asks, and checks nvidia-smi only after', () => {
  const at = (s) => { const i = script.indexOf(s); assert.ok(i > 0, s); return i; };
  const installed = at("Complete-Step 'driver-installed'");
  const restart = at("if ($code -eq 1) { Complete-Step 'driver-restarted'; Request-Restart");
  const check = at("$smi = Find-Smi\n");
  const done = at("Complete-Step 'driver'\n");
  assert.ok(installed < restart && restart < check && check < done);
  assert.equal((script.match(/Request-Restart /g) ?? []).length, 2, 'the installer\'s request, and nvidia-smi not ready');
  assert.match(script, /if \(-not \(Test-Step 'driver-installed'\)\) \{/);
  // Install-Everything returns at a requested restart; the main part restarts
  // instead of marking the set-up finished.
  assert.match(script, /Install-Everything\r?\n\s+if \(\$script:RestartReason\) \{/);
});

test('every call that can hang has a time limit', () => {
  // Native programs run through Invoke-Native or Get-NativeLines, both of
  // which stop the program after a limit; nothing calls one bare with &.
  for (const [i, line] of codeLines.entries()) {
    if (/(^|[^\w])& /.test(line)) assert.fail(`line ${i + 1} calls a program without a time limit: ${scriptLines[i].trim()}`);
  }
  assert.match(script, /function Invoke-Bounded\(\[string\]\$File, \[string\[\]\]\$Arguments, \[int\]\$Seconds\)/);
  assert.match(script, /if \(-not \$process\.WaitForExit\(\$Seconds \* 1000\)\)/);
  // Add-WindowsCapability runs in a timed job.
  const capability = scriptLines.findIndex((l) => l.includes("Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'"));
  assert.ok(capability > 0);
  assert.match(scriptLines[capability], /Invoke-Timed 'adding the OpenSSH Server capability' \d+ \{/);
  // Starting, stopping and restarting a service waits for as long as the
  // service takes; each runs in a timed job.
  for (const line of scriptLines.filter((l) => /\b(Start|Stop|Restart)-Service\b/.test(l) && !/^\s*#/.test(l))) {
    assert.match(line, /Invoke-Timed ('[^']+'|"[^"]+") \d+ \{/, line.trim());
  }
  // Every Start-Process is waited on with a limit: the installers, the
  // bounded native programs, and taskkill (a minute).
  const starts = scriptLines.filter((l) => /Start-Process /.test(l));
  assert.equal(starts.length, 3);
  assert.equal((script.match(/\.WaitForExit\(\S/g) ?? []).length, 3);
  assert.equal(/\.WaitForExit\(\)/.test(script), false, 'no WaitForExit without a limit');
});

// The script's main catch block: what a failed boot does.
const failureBlock = () => {
  const m = /\n\} catch \{\n  \$failed = \$true\n([\s\S]*?)\n\} finally \{\n([\s\S]*?)\n\}\n/.exec(script);
  assert.ok(m, 'the main catch and finally blocks');
  return { onFailure: m[1], always: m[2] };
};

test('a failed boot restarts itself at most twice in a row: the count is written before the restart, cleared only by a boot that did not fail', () => {
  assert.match(script, /^\$MaxFailureRestarts = 2$/m);
  const { onFailure, always } = failureBlock();
  assert.match(onFailure, /Log "FAILED: \$_"/);
  // Inside the bound's condition, the count is written first, then the
  // restart asked for; the other branch says no restart is left.
  const bound = /\n    if \(\$count -lt \$MaxFailureRestarts\) \{\n([\s\S]*?)\n    \} else \{\n([\s\S]*?)\n    \}/.exec(onFailure);
  assert.ok(bound, 'the bound: if ($count -lt $MaxFailureRestarts) { ... } else { ... }');
  const [, within, otherwise] = bound;
  const write = within.indexOf('Set-Content -Path $FailureCount -Value ($count + 1)');
  const restart = within.indexOf('$restart = $true');
  assert.ok(write >= 0 && restart > write, 'the count is written before the restart is asked for');
  assert.equal(otherwise.includes('$restart = $true'), false);
  assert.match(otherwise, /no automatic restart left/);
  assert.equal((script.match(/\$restart = \$true/g) ?? []).length, 3, 'the set-up, the new-user boot, and the bounded failure restart');
  // The count is read as a number, and is removed in exactly one place: in the
  // finally block, only when the boot did not fail.
  assert.match(onFailure, /\$count = \[int\]\(Get-Content \$FailureCount -TotalCount 1\)/);
  const removals = scriptLines.filter((l) => /Remove-Item[^\n]*\$FailureCount/.test(l));
  assert.deepEqual(removals.map((l) => l.trim()), ['if (-not $failed) { Remove-Item $FailureCount -Force -ErrorAction SilentlyContinue }']);
  assert.ok(always.includes(removals[0].trim()));
});

test('a failure restart first waits, a bounded time, for Windows Installer to be idle', () => {
  const { onFailure } = failureBlock();
  const wait = onFailure.indexOf('try { Wait-InstallerIdle 15 } catch {');
  assert.ok(wait >= 0, 'Wait-InstallerIdle 15, its failure caught');
  assert.ok(wait < onFailure.indexOf('$restart = $true'));
});

test('a new desktop user un-verifies the machine before anything else that can fail', () => {
  const branch = /\} elseif \(-not \(Test-Step \$UserStep\)\) \{\n([\s\S]*?)\n  \} elseif/.exec(script)[1];
  const code = branch.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.trim());
  assert.equal(code[0], "Remove-Item (Join-Path $Root 'verified') -ErrorAction SilentlyContinue");
  assert.ok(code.indexOf('Set-DesktopUser') > 0 && code.indexOf('Set-MetadataBlock') > code.indexOf('Set-DesktopUser'));
});

test('nvidia-smi not ready after the driver is installed asks for one restart before it fails the step', () => {
  const step = /if \(-not \(Test-Step 'driver'\)\) \{\n([\s\S]*?)\n    Complete-Step 'driver'\n/.exec(script)[1];
  const once = step.indexOf("if (-not (Test-Step 'driver-restarted')) {");
  const fail = step.indexOf('throw "nvidia-smi');
  assert.ok(once > step.indexOf('$smi = Find-Smi') && once < fail, 'the one restart comes before the failure');
  assert.match(step, /Complete-Step 'driver-restarted'\n\s+Request-Restart "nvidia-smi/);
  // The installer's own request for a restart uses up the same one restart.
  assert.match(step, /if \(\$code -eq 1\) \{ Complete-Step 'driver-restarted'; Request-Restart/);
});

// The C# the display task compiles, as Microsoft declares DEVMODEW and
// ChangeDisplaySettingsEx.
const displaySource = /\$DisplaySource = @"\n([\s\S]*?)\n"@/.exec(script)[1];

test('DEVMODEW: Unicode, the fields in Microsoft\'s order with their types, two 32-character strings', () => {
  assert.match(displaySource, /\[StructLayout\(LayoutKind\.Sequential, CharSet = CharSet\.Unicode\)\]\n\s+public struct DEVMODE \{/);
  const body = /public struct DEVMODE \{([\s\S]*?)\n\s+\}/.exec(displaySource)[1];
  const fields = [...body.matchAll(/(\[MarshalAs\(UnmanagedType\.ByValTStr, SizeConst = (\d+)\)\] )?public (string|short|int) ([^;]+);/g)]
    .flatMap(([, , size, type, names]) => names.split(',').map((n) => `${type}${size ? `[${size}]` : ''} ${n.trim()}`));
  assert.deepEqual(fields, [
    'string[32] dmDeviceName',
    'short dmSpecVersion', 'short dmDriverVersion', 'short dmSize', 'short dmDriverExtra',
    'int dmFields',
    'int dmPositionX', 'int dmPositionY', 'int dmDisplayOrientation', 'int dmDisplayFixedOutput',
    'short dmColor', 'short dmDuplex', 'short dmYResolution', 'short dmTTOption', 'short dmCollate',
    'string[32] dmFormName',
    'short dmLogPixels',
    'int dmBitsPerPel', 'int dmPelsWidth', 'int dmPelsHeight', 'int dmDisplayFlags', 'int dmDisplayFrequency',
    'int dmICMMethod', 'int dmICMIntent', 'int dmMediaType', 'int dmDitherType', 'int dmReserved1', 'int dmReserved2',
    'int dmPanningWidth', 'int dmPanningHeight',
  ]);
  assert.equal((displaySource.match(/SizeConst = 32/g) ?? []).length, 2);
});

test('ChangeDisplaySettingsEx: both imports Unicode, width and height flagged, saved for the user', () => {
  const imports = displaySource.split('\n').filter((l) => l.includes('DllImport'));
  assert.equal(imports.length, 2);
  for (const line of imports) assert.match(line, /\[DllImport\("user32\.dll", CharSet = CharSet\.Unicode\)\] static extern /);
  assert.match(imports[0], /bool EnumDisplaySettings\(string device, int mode, ref DEVMODE dm\)/);
  assert.match(imports[1], /int ChangeDisplaySettingsEx\(string device, ref DEVMODE dm, IntPtr hwnd, int flags, IntPtr param\)/);
  // DM_PELSWIDTH 0x80000, DM_PELSHEIGHT 0x100000; CDS_UPDATEREGISTRY 0x01.
  assert.match(displaySource, /dm\.dmFields = 0x80000 \| 0x100000;/);
  assert.match(displaySource, /ChangeDisplaySettingsEx\(null, ref dm, IntPtr\.Zero, 0x01, IntPtr\.Zero\)/);
  assert.match(displaySource, /EnumDisplaySettings\(null, -1, ref dm\)/); // ENUM_CURRENT_SETTINGS
});

test('the display task runs a script file the desktop user may read and run but not change, checked after set-up', () => {
  assert.match(script, /^\$DisplayWidth = 1920$/m);
  assert.match(script, /^\$DisplayHeight = 1080$/m);
  assert.equal(script.includes('-EncodedCommand'), false);
  assert.match(script, /^\$DisplayDir = Join-Path \$env:ProgramData 'test-rig-display'$/m);
  assert.match(script, /-Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"\$DisplayScript`""/);
  assert.match(script, /Invoke-Native 'icacls\.exe' @\(\$DisplayDir, '\/inheritance:r', '\/grant:r', '\*S-1-5-18:\(OI\)\(CI\)F', '\*S-1-5-32-544:\(OI\)\(CI\)F', "\*\$\(\$sid\):\(OI\)\(CI\)RX"\)/);
  assert.match(script, /New-ScheduledTaskTrigger -AtLogOn -User/);
  assert.match(script, /-LogonType Interactive -RunLevel Limited/);
  // The check after set-up: the script file's access, then the size.
  assert.match(script, /function Test-DisplayScriptAccess/);
  assert.match(script, /\n  Test-DisplayScriptAccess\n/);
  assert.match(script, /Display: \$\(\$adapter\.CurrentHorizontalResolution\)x\$\(\$adapter\.CurrentVerticalResolution\)/);
});
