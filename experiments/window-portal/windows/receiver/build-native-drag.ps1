$ErrorActionPreference = 'Stop'
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
& (Join-Path $framework 'csc.exe') /nologo /target:exe /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll "/out:$PSScriptRoot\WindowPortal.NativeDrag.exe" "$PSScriptRoot\NativeDrag.cs"
if ($LASTEXITCODE -ne 0) { throw 'Native drag helper compilation failed' }
