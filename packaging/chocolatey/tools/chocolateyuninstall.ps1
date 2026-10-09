$ErrorActionPreference = 'Stop'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'FluxDL.lnk'
if (Test-Path $shortcut) { Remove-Item $shortcut -Force }
