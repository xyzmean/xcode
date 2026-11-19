$ErrorActionPreference = 'Stop'

$arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
    'X64' { 'x64' }
    'Arm64' { 'arm64' }
    default { throw 'Unsupported CPU architecture.' }
}

$base = 'https://github.com/xyzmean/xcode/releases/latest/download'
$asset = "xcode-windows-$arch.exe"
$binDir = Join-Path $env:LOCALAPPDATA 'Programs\xCode'
$stage = Join-Path $binDir ('.xcode-install-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $stage -Force | Out-Null
try {
    $checksums = Join-Path $stage 'SHA256SUMS'
    $binary = Join-Path $stage 'xcode.exe'
    Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $checksums
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $binary
    $pattern = '^([0-9a-f]{64})  ' + [regex]::Escape($asset) + '$'
    $expected = @(Get-Content -LiteralPath $checksums | ForEach-Object {
        if ($_ -cmatch $pattern) { $Matches[1] }
    })
    if ($expected.Count -ne 1 -or (Get-FileHash -Algorithm SHA256 -LiteralPath $binary).Hash -ne $expected[0]) {
        throw "SHA-256 mismatch for $asset"
    }

    $destination = Join-Path $binDir 'xcode.exe'
    Move-Item -LiteralPath $binary -Destination $destination -Force
    Write-Output "Installed $destination"
    if (($env:Path -split ';') -notcontains $binDir) {
        Write-Output "Add $binDir to your PATH to run xcode by name."
    }
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
