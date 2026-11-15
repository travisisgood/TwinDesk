// Focused, unpacked Windows test build. No installer, certificate or driver changes.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const win = path.resolve(__dirname, '..');
const root = path.dirname(win);
const output = process.argv[2] && path.resolve(process.argv[2]);
if (process.platform !== 'win32' || !output) throw new Error('Usage on Windows: node installer/build-network-monitor.js <new output folder>');
if (fs.existsSync(output)) throw new Error('Choose a new output folder; existing builds are never overwritten');
const fw = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const kits = path.join(process.env['ProgramFiles(x86)'], 'Windows Kits', '10', 'UnionMetadata');
const sdk = fs.readdirSync(kits).filter(n => /^10\./.test(n) && fs.existsSync(path.join(kits, n, 'Windows.winmd')))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
if (!sdk) throw new Error('Windows SDK UnionMetadata is required');
const helperBin = path.join(root, 'windows-helper', 'bin');
fs.mkdirSync(helperBin, { recursive: true });
const refs = ['System.Web.Extensions.dll', 'System.Windows.Forms.dll', 'System.Drawing.dll',
  ...['UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll'].map(n => path.join(fw, 'WPF', n)),
  path.join(kits, sdk, 'Windows.winmd'),
  ...['System.Runtime.WindowsRuntime.dll', 'System.Runtime.dll', 'System.Threading.Tasks.dll',
    'System.Runtime.InteropServices.WindowsRuntime.dll'].map(n => path.join(fw, n))];
const src = path.join(root, 'windows-helper', 'src');
for (const multi of [false, true]) {
  const name = multi ? 'macshare-winhelper-multi.exe' : 'macshare-winhelper.exe';
  execFileSync(path.join(fw, 'csc.exe'), ['/nologo', '/optimize+', '/platform:anycpu', '/target:exe',
    ...(multi ? ['/define:MULTI'] : []), '/out:' + path.join(helperBin, name),
    ...refs.map(r => '/r:' + r), ...fs.readdirSync(src).filter(n => n.endsWith('.cs')).map(n => path.join(src, n))],
  { stdio: 'inherit', windowsHide: true });
}
const electron = path.join(win, 'node_modules', 'electron', 'dist');
if (!fs.existsSync(path.join(electron, 'electron.exe'))) throw new Error('Run npm ci in windows first');
fs.cpSync(electron, output, { recursive: true });
fs.renameSync(path.join(output, 'electron.exe'), path.join(output, 'TwinDesk Network Monitor.exe'));
const app = path.join(output, 'resources', 'app');
fs.mkdirSync(app, { recursive: true });
const skip = new Set(['node_modules', 'dist', 'test', 'installer', 'package-lock.json', 'fullkvm']);
fs.cpSync(win, path.join(app, 'windows'), { recursive: true, filter: p => !skip.has(path.basename(p)) });
for (const name of ['shared', 'web', 'licenses']) {
  fs.cpSync(path.join(root, name), path.join(app, name), { recursive: true,
    filter: p => !['test', 'node_modules', 'shortcuts-src', 'fullkvm'].includes(path.basename(p)) });
}
fs.cpSync(path.join(root, 'android', 'app', 'src', 'main', 'assets', 'web'), path.join(app, 'android-web'), { recursive: true });
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES']) fs.copyFileSync(path.join(root, name), path.join(app, name));
for (const name of ['macshare-winhelper.exe', 'macshare-winhelper-multi.exe']) {
  const dest = path.join(app, 'windows-helper', 'bin', name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(helperBin, name), dest);
}
for (const name of ['scrcpy-server', 'twindesk-relay.jar']) {
  const dest = path.join(app, 'windows', 'vendor', name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, 'mac', 'vendor', name), dest);
}
const pkg = require(path.join(win, 'package.json'));
for (const name of Object.keys(pkg.dependencies)) fs.cpSync(path.join(win, 'node_modules', name), path.join(app, 'node_modules', name), { recursive: true });
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'twindesk-network-monitor-test',
  productName: 'TwinDesk Network Monitor', version: pkg.version, main: 'network-test.cjs', license: 'GPL-3.0' }, null, 2));
fs.writeFileSync(path.join(app, 'network-test.cjs'), `
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const profile = path.join(path.dirname(process.execPath), 'test-profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.commandLine.appendSwitch('user-data-dir', profile);
app.commandLine.appendSwitch('network-monitor-test');
const file = path.join(profile, 'settings.json');
let settings = {};
if (fs.existsSync(file)) settings = JSON.parse(fs.readFileSync(file, 'utf8'));
settings.updates = { ...settings.updates, auto: false, install: false };
if (!fs.existsSync(file)) {
  settings.pcScreen = { sound: false, input: true, remote: true, extendSize: 'mac', maxHeight: 'extend', fps: 60 };
  settings.clipboard = { enabled: true, images: true };
  settings.audio = { send: false };
  settings.ui = { tab: 'connection' };
}
fs.writeFileSync(file, JSON.stringify(settings, null, 2));
require('./windows/main.js');
`);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
fs.writeFileSync(path.join(output, 'BUILD-INFO.txt'), `TwinDesk Network Monitor Windows test build\nSource: https://github.com/travisisgood/TwinDesk/tree/windows-network-monitor\nBase commit: ${commit}\nIncludes working-tree changes at build time.\nElectron: ${require(path.join(win, 'node_modules/electron/package.json')).version}\nNo driver installed by build. Optional phone/camera/gamepad/signing binaries omitted.\nNative Rust input lane omitted: existing Node input lane is used.\nSettings: test-profile beside the executable. Upstream auto-updates disabled.\n`);
console.log('Built: ' + path.join(output, 'TwinDesk Network Monitor.exe'));
