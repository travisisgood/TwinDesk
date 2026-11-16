$ErrorActionPreference='Stop'
$framework=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
& (Join-Path $framework 'csc.exe') /nologo /target:exe /r:System.Web.Extensions.dll "/r:$framework\WPF\UIAutomationClient.dll" "/r:$framework\WPF\UIAutomationTypes.dll" "/r:$framework\WPF\WindowsBase.dll" "/out:$PSScriptRoot\ExplorerInput.exe" "$PSScriptRoot\ExplorerInput.cs"
if($LASTEXITCODE -ne 0){throw 'Explorer input helper build failed'}
