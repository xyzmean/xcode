#!/bin/sh
set -eu

case "$(uname -s)" in
  Linux) platform=linux ;;
  Darwin) platform=darwin ;;
  *) printf '%s\n' 'Unsupported OS: use the PowerShell installer on Windows.' >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) printf '%s\n' 'Unsupported CPU architecture.' >&2; exit 1 ;;
esac

base=https://github.com/xyzmean/xcode/releases/latest/download
asset=xcode-$platform-$arch
bindir=$HOME/.local/bin
mkdir -p "$bindir"
stage=$(mktemp -d "$bindir/.xcode-install.XXXXXX")
trap 'rm -r "$stage"' EXIT
trap 'exit 1' HUP INT TERM

curl -fsSL --proto '=https' --proto-redir '=https' "$base/SHA256SUMS" -o "$stage/SHA256SUMS"
curl -fsSL --proto '=https' --proto-redir '=https' "$base/$asset" -o "$stage/xcode"
expected=$(awk -v name="$asset" '$2 == name { print $1 }' "$stage/SHA256SUMS")
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum < "$stage/xcode")
else
  actual=$(shasum -a 256 < "$stage/xcode")
fi
if [ "${actual%% *}" != "$expected" ]; then
  printf '%s\n' "SHA-256 mismatch for $asset" >&2
  exit 1
fi

chmod 755 "$stage/xcode"
mv -f "$stage/xcode" "$bindir/xcode"
printf 'Installed %s\n' "$bindir/xcode"
case ":$PATH:" in
  *":$bindir:"*) ;;
  *) printf 'Add %s to your PATH to run xcode by name.\n' "$bindir" ;;
esac
