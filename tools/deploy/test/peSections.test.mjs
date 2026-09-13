import { describe, it, expect } from 'vitest';
import { equalOutsideResources, peSections } from '../lib/peSections.mjs';

// Minimal PE32+: DOS stub, PE sig, COFF, optional header, section table, raw data.
function pe(sections) {
  const n = sections.length;
  const lfanew = 0x80, optSize = 240;
  const table = lfanew + 4 + 20 + optSize;
  let rawoff = (table + 40 * n + 0x1ff) & ~0x1ff;
  const laid = sections.map(([name, rva, raw]) => {
    const rawsize = (raw.length + 0x1ff) & ~0x1ff;
    const s = { name, rva, raw, rawoff, rawsize };
    rawoff += rawsize;
    return s;
  });
  const buf = Buffer.alloc(rawoff);
  buf.write('MZ', 0, 'latin1');
  buf.writeUInt32LE(lfanew, 0x3c);
  buf.write('PE\0\0', lfanew, 'latin1');
  buf.writeUInt16LE(0x8664, lfanew + 4);
  buf.writeUInt16LE(n, lfanew + 6);
  buf.writeUInt16LE(optSize, lfanew + 20);
  buf.writeUInt16LE(0x20b, lfanew + 24);
  laid.forEach((s, i) => {
    const o = table + 40 * i;
    buf.write(s.name.padEnd(8, '\0'), o, 'latin1');
    buf.writeUInt32LE(s.raw.length, o + 8);
    buf.writeUInt32LE(s.rva, o + 12);
    buf.writeUInt32LE(s.rawsize, o + 16);
    buf.writeUInt32LE(s.rawoff, o + 20);
    s.raw.copy(buf, s.rawoff);
  });
  return buf;
}

const text = Buffer.concat([Buffer.from('565753', 'hex'), Buffer.alloc(61, 0x90)]);
const reloc = Buffer.alloc(40, 7);

describe('peSections', () => {
  it('reads the table in order', () => {
    const b = pe([['.text', 0x1000, text], ['.rsrc', 0x3000, Buffer.alloc(100, 1)]]);
    expect(peSections(b).map((s) => s.name)).toEqual(['.text', '.rsrc']);
    expect(peSections(b)[0].rawoff).toBe(0x200);
  });
  it('throws on non-PE', () => {
    expect(() => peSections(Buffer.from('not a pe'))).toThrow(/PE/);
  });
});

describe('equalOutsideResources', () => {
  it('accepts identical files', () => {
    const a = pe([['.text', 0x1000, text], ['.rsrc', 0x3000, Buffer.alloc(100, 1)], ['.reloc', 0x4000, reloc]]);
    expect(equalOutsideResources(a, Buffer.from(a))).toBe(true);
  });
  it('accepts a replaced and grown .rsrc that shifts a later section', () => {
    const a = pe([['.text', 0x1000, text], ['.rsrc', 0x3000, Buffer.alloc(100, 1)], ['.reloc', 0x4000, reloc]]);
    const b = pe([['.text', 0x1000, text], ['.rsrc', 0x3000, Buffer.alloc(1500, 2)], ['.reloc', 0x5000, reloc]]);
    expect(a.equals(b)).toBe(false);
    expect(equalOutsideResources(a, b)).toBe(true);
  });
  it('rejects one differing .text byte (the patch reverted)', () => {
    const stock = Buffer.from(text);
    stock.write('31c0c3', 0, 'hex');
    const a = pe([['.text', 0x1000, text], ['.rsrc', 0x3000, Buffer.alloc(100, 1)]]);
    const b = pe([['.text', 0x1000, stock], ['.rsrc', 0x3000, Buffer.alloc(100, 1)]]);
    expect(equalOutsideResources(a, b)).toBe(false);
  });
  it('rejects a different section list', () => {
    const a = pe([['.text', 0x1000, text], ['.rsrc', 0x3000, Buffer.alloc(100, 1)]]);
    const b = pe([['.text', 0x1000, text], ['.rsrc', 0x3000, Buffer.alloc(100, 1)], ['.reloc', 0x4000, reloc]]);
    expect(equalOutsideResources(a, b)).toBe(false);
  });
  it('rejects a section whose raw size differs', () => {
    const a = pe([['.text', 0x1000, text], ['.rsrc', 0x3000, Buffer.alloc(100, 1)]]);
    const b = pe([['.text', 0x1000, Buffer.concat([text, Buffer.alloc(0x200)]) ], ['.rsrc', 0x3000, Buffer.alloc(100, 1)]]);
    expect(equalOutsideResources(a, b)).toBe(false);
  });
});
