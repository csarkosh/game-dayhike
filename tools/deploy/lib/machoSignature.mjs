// Compare two Mach-O binaries ignoring only what `codesign` owns.
//
// The desktop release ships the mirror's Electron Framework *re-signed*: the
// app bundle is ad-hoc sealed after packaging (desktop/afterPack.cjs), and a
// seal covers nested code, so the framework's signature blob is rewritten.
// Re-signing changes exactly three things: the signature blob itself (the
// tail of the file, from LC_CODE_SIGNATURE.dataoff), that load command's
// `datasize`, and the `vmsize`/`filesize` of the __LINKEDIT segment that
// holds the blob. Everything else — every instruction, including the eight
// patched bytes — must be identical, or the packaged framework is not the
// mirror's. This is the same budget the mirror's own verify.py enforces.
//
// Pure: takes buffers, so it is testable with synthetic Mach-O files.

const MH_MAGIC_64 = 0xfeedfacf;
const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;
const HEADER_SIZE = 32;

/** Byte ranges `codesign` rewrites, and where the signature blob begins. */
export function signatureWindows(buf) {
  if (buf.length < HEADER_SIZE || buf.readUInt32LE(0) !== MH_MAGIC_64) {
    throw new Error('not a 64-bit little-endian Mach-O');
  }
  const ncmds = buf.readUInt32LE(16);
  const windows = [];
  let dataoff = null;
  let off = HEADER_SIZE;
  for (let i = 0; i < ncmds; i++) {
    if (off + 8 > buf.length) throw new Error('load commands run past the end of the file');
    const cmd = buf.readUInt32LE(off);
    const cmdsize = buf.readUInt32LE(off + 4);
    if (cmdsize < 8 || off + cmdsize > buf.length) throw new Error(`load command ${i} has a bad size`);
    if (cmd === LC_SEGMENT_64 && buf.toString('latin1', off + 8, off + 24).replace(/\0+$/, '') === '__LINKEDIT') {
      windows.push([off + 32, off + 40]); // vmsize
      windows.push([off + 48, off + 56]); // filesize
    } else if (cmd === LC_CODE_SIGNATURE) {
      dataoff = buf.readUInt32LE(off + 8);
      windows.push([off + 12, off + 16]); // datasize
    }
    off += cmdsize;
  }
  if (dataoff === null) throw new Error('no LC_CODE_SIGNATURE — the binary is unsigned');
  if (dataoff > buf.length) throw new Error('LC_CODE_SIGNATURE points past the end of the file');
  return { dataoff, windows: windows.sort((a, b) => a[0] - b[0]) };
}

/**
 * True when `a` and `b` are the same code: byte-identical up to the signature
 * blob, except inside the windows `codesign` rewrites. Both must be signed
 * Mach-O 64 files, and the blob must start at the same offset in each — a
 * different `dataoff` means the code itself is a different length.
 */
export function equalOutsideSignature(a, b) {
  const wa = signatureWindows(a);
  const wb = signatureWindows(b);
  if (wa.dataoff !== wb.dataoff) return false;
  if (wa.windows.length !== wb.windows.length) return false;
  for (let i = 0; i < wa.windows.length; i++) {
    if (wa.windows[i][0] !== wb.windows[i][0] || wa.windows[i][1] !== wb.windows[i][1]) return false;
  }
  let pos = 0;
  for (const [start, end] of wa.windows) {
    if (start > wa.dataoff) break;
    if (a.compare(b, pos, start, pos, start) !== 0) return false;
    pos = end;
  }
  return a.compare(b, pos, wa.dataoff, pos, wa.dataoff) === 0;
}
