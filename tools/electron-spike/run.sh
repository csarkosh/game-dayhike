#!/bin/sh
# run.sh <stock|patched-zero|patched-noeject> [ESC=osascript|sendInputEvent|manual]
cd "$(dirname "$0")"
VARIANT="$1" ESC="${2:-osascript}" ROUNDS="${ROUNDS:-3}" exec "./$1/Electron.app/Contents/MacOS/Electron" testapp 2>/dev/null
