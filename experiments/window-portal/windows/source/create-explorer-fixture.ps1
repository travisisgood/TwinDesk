param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$folder=Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) ('ExplorerNetwork-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $folder | Out-Null
Set-Content -LiteralPath (Join-Path $folder 'BASELINE.txt') -Value 'Disposable Windows-to-Mac baseline'
$shell=New-Object -ComObject Shell.Application
$shell.Explore($folder)
$window=$null
for($i=0;$i -lt 40 -and !$window;$i++){
 Start-Sleep -Milliseconds 200
 foreach($candidate in @($shell.Windows())){try{if($candidate.Document.Folder.Self.Path -eq $folder){$window=$candidate;break}}catch{}}
}
if(!$window){throw 'Dedicated Explorer window unavailable'}
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class ExplorerFixtureWindow {
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int command);
}
'@
[ExplorerFixtureWindow]::ShowWindowAsync([IntPtr][long]$window.HWND,9) | Out-Null
Start-Sleep -Milliseconds 300
$window.Left=100;$window.Top=100;$window.Width=900;$window.Height=650
$info=@{sourceWid=[long]$window.HWND;folder=$folder}
$info | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'explorer-fixture.json')
$info | ConvertTo-Json
