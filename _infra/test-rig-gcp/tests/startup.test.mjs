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
  const restart = at("if ($code -eq 1) { Request-Restart");
  const check = at("$smi = Find-Smi\n");
  const done = at("Complete-Step 'driver'\n");
  assert.ok(installed < restart && restart < check && check < done);
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

test('a failed boot restarts itself, at most twice in a row, and says so', () => {
  assert.match(script, /^\$MaxFailureRestarts = 2$/m);
  assert.match(script, /FAILED: /);
  assert.match(script, /no automatic restart left/);
  // A boot that does not fail clears the count.
  assert.match(script, /Remove-Item \$FailureCount -Force -ErrorAction SilentlyContinue/);
});

test('the console is set to 1920 x 1080 at every logon of the desktop user, by ChangeDisplaySettingsEx, and checked', () => {
  assert.match(script, /^\$DisplayWidth = 1920$/m);
  assert.match(script, /^\$DisplayHeight = 1080$/m);
  assert.match(script, /static extern int ChangeDisplaySettingsEx\(/);
  assert.match(script, /New-ScheduledTaskTrigger -AtLogOn -User/);
  assert.match(script, /-LogonType Interactive -RunLevel Limited/);
  assert.match(script, /Display: \$\(\$adapter\.CurrentHorizontalResolution\)x\$\(\$adapter\.CurrentVerticalResolution\)/);
  // DEVMODEW: the fields up to dmPanningHeight, as Microsoft declares them;
  // 220 bytes when laid out (two 32-character strings of 2 bytes each).
  const devmode = /public struct DEVMODE \{([\s\S]*?)\}/.exec(script)[1];
  const size = [...devmode.matchAll(/public (string|short|int) ([^;]+);/g)].reduce((sum, [, type, names]) => {
    const count = names.split(',').length;
    return sum + count * (type === 'string' ? 64 : type === 'short' ? 2 : 4);
  }, 0);
  assert.equal(size, 220);
});
