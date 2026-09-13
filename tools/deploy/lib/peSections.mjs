// Compare two PE files ignoring only the resource section.
//
// There is no moment at which a packaged `Day Hike.exe` is byte-identical to
// the mirror's `electron.exe`: electron-builder writes the asar-integrity
// resource into `.rsrc` before the afterPack hook runs, and edits the icon and
// version strings in `.rsrc` again after it. So `.rsrc` is never comparable,
// and this rule — same section list by name, identical raw bytes in every
// section but that one, at each file's own raw offset (a grown `.rsrc` shifts
// what follows it) — is what both the hook and tools/deploy/desktop.mjs use.
// `.text`, which carries the patched instructions, is covered. Headers are
// ignored: checksum, SizeOfImage and the `.rsrc` entry itself all change.
// Pure: buffers in, so a synthetic PE can test it.

export function peSections(buf) {
  if (buf.length < 0x40 || buf.toString('latin1', 0, 2) !== 'MZ') throw new Error('not a PE file (no MZ)');
  const lfanew = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', lfanew, lfanew + 4) !== 'PE\0\0') throw new Error('not a PE file (no PE signature)');
  const coff = lfanew + 4;
  const n = buf.readUInt16LE(coff + 2);
  const optSize = buf.readUInt16LE(coff + 16);
  const opt = coff + 20;
  if (buf.readUInt16LE(opt) !== 0x20b) throw new Error('not a PE32+ image');
  const table = opt + optSize;
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = table + 40 * i;
    if (o + 40 > buf.length) throw new Error('section table runs past the end of the file');
    out.push({
      name: buf.toString('latin1', o, o + 8).replace(/\0+$/, ''),
      vsize: buf.readUInt32LE(o + 8),
      rva: buf.readUInt32LE(o + 12),
      rawsize: buf.readUInt32LE(o + 16),
      rawoff: buf.readUInt32LE(o + 20),
    });
  }
  return out;
}

/** True when `a` and `b` have the same sections and identical bytes in all but `.rsrc`. */
export function equalOutsideResources(a, b) {
  const sa = peSections(a);
  const sb = peSections(b);
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) {
    const x = sa[i];
    const y = sb[i];
    if (x.name !== y.name) return false;
    if (x.name === '.rsrc') continue;
    if (x.rawsize !== y.rawsize) return false;
    if (x.rawoff + x.rawsize > a.length || y.rawoff + y.rawsize > b.length) return false;
    if (a.compare(b, y.rawoff, y.rawoff + y.rawsize, x.rawoff, x.rawoff + x.rawsize) !== 0) return false;
  }
  return true;
}
