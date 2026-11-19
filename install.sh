#!/usr/bin/env bash
set -euo pipefail

REPO="${XCODE_REPO:-xyzmean/xcode}"
INSTALL_DIR="${XCODE_INSTALL_DIR:-$HOME/.local/bin}"
BIN_NAME="xcode"

detect_target() {
  local os arch
  case "$(uname -s)" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    *)
      echo "Unsupported OS: $(uname -s)" >&2
      exit 1
      ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac

  echo "${os}-${arch}"
}

TARGET="$(detect_target)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
LOCAL_BIN="${SCRIPT_DIR}/dist/${TARGET}/${BIN_NAME}"

mkdir -p "$INSTALL_DIR"
DEST="${INSTALL_DIR}/${BIN_NAME}"

if [ -n "$SCRIPT_DIR" ] && [ -f "$LOCAL_BIN" ]; then
  echo "Installing ${BIN_NAME} (${TARGET}) from local build..."
  TMP_FILE="$(mktemp "${DEST}.XXXXXX")"
  trap 'rm -f "$TMP_FILE"' EXIT
  cp "$LOCAL_BIN" "$TMP_FILE"
  chmod +x "$TMP_FILE"
  mv -f "$TMP_FILE" "$DEST"
else
  URL="${XCODE_DOWNLOAD_URL:-https://github.com/${REPO}/releases/latest/download/${BIN_NAME}-${TARGET}}"
  echo "Downloading ${BIN_NAME} (${TARGET}) from ${URL}..."
  TMP_FILE="$(mktemp)"
  trap 'rm -f "$TMP_FILE"' EXIT
  curl -fsSL "$URL" -o "$TMP_FILE"
  mv "$TMP_FILE" "$DEST"
fi

chmod +x "$DEST"
echo "Installed ${BIN_NAME} to ${DEST}"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo ""
    echo "Add ${INSTALL_DIR} to your PATH:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

"${DEST}" --version || true
