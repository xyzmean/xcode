$ErrorActionPreference = "Stop"

$Repo = if ($env:XCODE_REPO) { $env:XCODE_REPO } else { "xyzmean/xcode" }
$InstallDir = if ($env:XCODE_INSTALL_DIR) { $env:XCODE_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "xcode\bin" }
$BinName = "xcode.exe"
$Target = "windows-x64"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$Dest = Join-Path $InstallDir $BinName
$LocalBin = Join-Path $PSScriptRoot "dist\$Target\$BinName"

if ($PSScriptRoot -and (Test-Path $LocalBin)) {
  Write-Host "Installing $BinName ($Target) from local build..."
  Copy-Item -Path $LocalBin -Destination $Dest -Force
} else {
  $Url = if ($env:XCODE_DOWNLOAD_URL) { $env:XCODE_DOWNLOAD_URL } else { "https://github.com/$Repo/releases/latest/download/$BinName" }
  Write-Host "Downloading $BinName ($Target) from $Url..."
  Invoke-WebRequest -Uri $Url -OutFile $Dest
}

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($UserPath -split ";" | Where-Object { $_ -eq $InstallDir })) {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
  Write-Host "Added $InstallDir to user PATH (restart your terminal to use 'xcode')."
}

Write-Host "Installed $BinName to $Dest"
& $Dest --version
