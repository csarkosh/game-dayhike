#!/usr/bin/env python3
"""Throwaway spike: binary-patch Electron 44.0.0 darwin-arm64's pointer-lock Esc cooldown.

Usage: patch.py <variant> <src Electron.app> <dst Electron.app>
  variant 'zero'  : kEffectiveUserEscapeDuration 1250ms -> 0ms (RequestToLockPointer)
  variant 'noeject': PointerLockController::HandleUserPressedEscape() -> return false
Offsets are for Electron Framework UUID 4C4C448B-5555-3144-A179-5775D5EF8BF6 only.
"""
import shutil, subprocess, sys
variant, src, dst = sys.argv[1:4]
FW = "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"
PATCHES = {
    "zero": [
        # mov w9,#0x12d0 ; movk w9,#0x13,lsl#16  ->  mov w9,#0 ; nop
        (0x903c61c, bytes.fromhex("095a8252 6902a072".replace(" ", "")),
                    bytes.fromhex("09008052 1f2003d5".replace(" ", ""))),
    ],
    "noeject": [
        # stp x20,x19,[sp,#-0x20]! ; stp x29,x30,[sp,#0x10]  ->  mov w0,#0 ; ret
        (0x903ca3c, bytes.fromhex("f44fbea9 fd7b01a9".replace(" ", "")),
                    bytes.fromhex("00008052 c0035fd6".replace(" ", ""))),
    ],
}
shutil.rmtree(dst, ignore_errors=True)
shutil.copytree(src, dst, symlinks=True)
path = f"{dst}/{FW}"
with open(path, "r+b") as f:
    for off, old, new in PATCHES[variant]:
        f.seek(off); got = f.read(len(old))
        assert got == old, f"bytes at {off:#x} are {got.hex()}, expected {old.hex()}"
        f.seek(off); f.write(new)
        print(f"patched {off:#x}: {old.hex()} -> {new.hex()}")
subprocess.check_call(["codesign", "--force", "--deep", "--sign", "-", dst])
print("re-signed", dst)
