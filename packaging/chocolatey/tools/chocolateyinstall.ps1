$ErrorActionPreference = 'Stop'
$version = '1.8.1'
$url = "https://github.com/Myung-Young/FluxDL/releases/download/v$version/FluxDL-Portable-$version.exe"
$hash = 'C496F9D2507667EDD826F804BF04B16D85F814EEE65AF3DE89C341CFEF09C0E2'
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$dest = Join-Path $toolsDir "FluxDL-Portable-$version.exe"
Get-ChocolateyWebFile -PackageName 'fluxdl' -FileFullPath $dest -Url $url -Checksum $hash -ChecksumType 'sha256'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'FluxDL.lnk'
Install-ChocolateyShortcut -ShortcutFilePath $shortcut -TargetPath $dest
