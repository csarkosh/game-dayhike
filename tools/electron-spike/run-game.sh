#!/bin/sh
# run-game.sh <stock|patched-zero|patched-noeject>  — needs the dev stack on :5173
cd "$(dirname "$0")"
VARIANT="$1" OUT="${OUT:-out}" exec "./$1/Electron.app/Contents/MacOS/Electron" shell 2>/dev/null
