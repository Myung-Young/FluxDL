$ErrorActionPreference = 'Stop'
$version = '1.8.0'
$url = "https://github.com/Myung-Young/FluxDL/releases/download/v$version/FluxDL-Portable-$version.exe"
$hash = '608B515A85A45C53DBAD796D5826E3D25C9C3692586ED51E4F620C13770B6107'
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$dest = Join-Path $toolsDir "FluxDL-Portable-$version.exe"
Get-ChocolateyWebFile -PackageName 'fluxdl' -FileFullPath $dest -Url $url -Checksum $hash -ChecksumType 'sha256'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'FluxDL.lnk'
Install-ChocolateyShortcut -ShortcutFilePath $shortcut -TargetPath $dest
