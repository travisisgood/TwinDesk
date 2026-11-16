param(
  [Parameter(Mandatory=$true)][string]$NativeExe,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ExplorerMinProbe {
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
}
'@
$out = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $out -Force | Out-Null
$fixture = Join-Path $out ('ExplorerMinProof-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
Set-Content -LiteralPath (Join-Path $fixture 'BASELINE.txt') -Value 'Baseline'
$shell = New-Object -ComObject Shell.Application
$shell.Explore($fixture)
$target = $null
for ($i=0; $i -lt 30 -and !$target; $i++) {
  Start-Sleep -Milliseconds 200
  foreach ($candidate in @($shell.Windows())) {
    try { if ($candidate.Document.Folder.Self.Path -eq $fixture) { $target=$candidate; break } } catch {}
  }
}
if (!$target) { throw 'Dedicated Explorer fixture did not open.' }
$windowHandle = [IntPtr][long]$target.HWND
$samples = [Collections.Generic.List[object]]::new()
function Capture([string]$phase) {
  $before = [ExplorerMinProbe]::IsIconic($windowHandle)
  $stdout = Join-Path $out ($phase+'.json')
  $stderr = Join-Path $out ($phase+'.stderr')
  $p = Start-Process -FilePath $NativeExe -ArgumentList @('print',$windowHandle.ToInt64()) -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  if (!$p.WaitForExit(4000)) { $p.Kill(); throw 'PrintWindow worker exceeded four-second deadline.' }
  $after = [ExplorerMinProbe]::IsIconic($windowHandle)
  $raw = Get-Content -LiteralPath $stdout -Raw
  if (!$raw) { $samples.Add([pscustomobject]@{phase=$phase;minimizedBefore=$before;minimizedAfter=$after;error='No PrintWindow frame';exitCode=$p.ExitCode}); return }
  $frame = $raw | ConvertFrom-Json
  $bytes = [Convert]::FromBase64String(($frame.image -split ',',2)[1])
  $png = Join-Path $out ($phase+'.png')
  [IO.File]::WriteAllBytes($png,$bytes)
  $img = [Drawing.Image]::FromFile($png)
  try { $samples.Add([pscustomobject]@{phase=$phase;minimizedBefore=$before;minimizedAfter=$after;width=$img.Width;height=$img.Height;sha256=(Get-FileHash -LiteralPath $png).Hash;image=$png}) } finally { $img.Dispose() }
}
try {
  Start-Sleep -Milliseconds 1000
  Capture 'visible'
  [ExplorerMinProbe]::ShowWindowAsync($windowHandle,6) | Out-Null
  Start-Sleep -Milliseconds 800
  if (![ExplorerMinProbe]::IsIconic($windowHandle)) { throw 'Explorer did not minimize; aborting hidden-state claim.' }
  Capture 'minimized-before'
  Set-Content -LiteralPath (Join-Path $fixture 'MINIMIZEDPROOF.txt') -Value 'Created after minimizing the actual Explorer source'
  for ($i=1; $i -le 3; $i++) { Start-Sleep -Milliseconds 1000; Capture ('minimized-after-'+$i) }
} finally {
  if ([ExplorerMinProbe]::IsWindow($windowHandle)) { [ExplorerMinProbe]::ShowWindowAsync($windowHandle,9) | Out-Null }
  Start-Sleep -Milliseconds 700
  Capture 'restored'
  [pscustomobject]@{fixture=$fixture;window=$windowHandle.ToInt64();samples=@($samples.ToArray());restored=![ExplorerMinProbe]::IsIconic($windowHandle)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $out 'results.json')
}
$samples | Select-Object phase,minimizedBefore,minimizedAfter,width,height,error | Format-Table
