#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="herdmode"
INSTALL_DIR="$HOME/.local/bin"
ICON_DIR="$HOME/.local/share/icons"
DESKTOP_DIR="$HOME/.local/share/applications"

echo "==> Checking prerequisites..."
if ! command -v bun &>/dev/null; then
    echo "Error: bun is not installed. Install it with: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo "==> Installing dependencies..."
cd "$SCRIPT_DIR"
bun install

echo "==> Building Herdmode..."
bun run build

# Find the built AppImage
APPIMAGE=$(find packages/desktop/release -maxdepth 1 -name '*.AppImage' -print -quit)
if [ -z "$APPIMAGE" ]; then
    echo "Error: No AppImage found in packages/desktop/release/"
    exit 1
fi

echo "==> Installing AppImage to $INSTALL_DIR/$APP_NAME..."
mkdir -p "$INSTALL_DIR"
cp "$APPIMAGE" "$INSTALL_DIR/$APP_NAME"
chmod +x "$INSTALL_DIR/$APP_NAME"

echo "==> Installing icon..."
mkdir -p "$ICON_DIR"
cp "$SCRIPT_DIR/packages/desktop/assets/icon.png" "$ICON_DIR/$APP_NAME.png"

echo "==> Creating desktop entry..."
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/$APP_NAME.desktop" << EOF
[Desktop Entry]
Name=Herdmode
Comment=Wrangle your Claude Code agents
Exec=$INSTALL_DIR/$APP_NAME
Icon=$ICON_DIR/$APP_NAME.png
Terminal=false
Type=Application
Categories=Development;
StartupWMClass=herdmode
EOF

echo "==> Done! Herdmode installed."
echo "    Run it with: herdmode"
echo "    Or find it in your app launcher."

if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo "    Note: $INSTALL_DIR is not in your PATH."
    echo "    Add it with: export PATH=\"$INSTALL_DIR:\$PATH\""
fi
