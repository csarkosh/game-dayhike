import { describe, it, expect } from 'vitest';
import { equalOutsideSignature, signatureWindows } from '../lib/machoSignature.mjs';

// A minimal signed Mach-O 64: header, a __LINKEDIT segment command, an
// LC_CODE_SIGNATURE command, then `code` bytes and the signature blob `sig`.
function macho({ code, sig, extraSeg = false }) {
  const cmds = [];
  const seg = (name, vmsize, filesize) => {
    const b = Buffer.alloc(72);
    b.writeUInt32LE(0x19, 0);
    b.writeUInt32LE(72, 4);
    b.write(name, 8, 'latin1');
    b.writeBigUInt64LE(BigInt(vmsize), 32);
    b.writeBigUInt64LE(BigInt(filesize), 48);
    return b;
  };
  if (extraSeg) cmds.push(seg('__TEXT', 4096, 4096));
  cmds.push(seg('__LINKEDIT', 4096, sig.length));
  const cs = Buffer.alloc(16);
  cs.writeUInt32LE(0x1d, 0);
  cs.writeUInt32LE(16, 4);
  const cmdBytes = Buffer.concat(cmds);
  const dataoff = 32 + cmdBytes.length + 16 + code.length;
  cs.writeUInt32LE(dataoff, 8);
  cs.writeUInt32LE(sig.length, 12);
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(cmds.length + 1, 16);
  header.writeUInt32LE(cmdBytes.length + 16, 20);
  return Buffer.concat([header, cmdBytes, cs, code, sig]);
}

const code = Buffer.from('f44fbea9fd7b01a9' + '00'.repeat(24), 'hex');

describe('signatureWindows', () => {
  it('finds the blob and the three fields codesign rewrites', () => {
    const b = macho({ code, sig: Buffer.alloc(64, 1) });
    const { dataoff, windows } = signatureWindows(b);
    expect(dataoff).toBe(32 + 72 + 16 + code.length);
    expect(windows).toEqual([
      [32 + 32, 32 + 40],
      [32 + 48, 32 + 56],
      [32 + 72 + 12, 32 + 72 + 16],
    ]);
  });
  it('rejects unsigned and non-Mach-O input', () => {
    expect(() => signatureWindows(Buffer.from('not a binary'))).toThrow(/Mach-O/);
    const unsigned = Buffer.alloc(32 + 72);
    unsigned.writeUInt32LE(0xfeedfacf, 0);
    unsigned.writeUInt32LE(0, 16);
    expect(() => signatureWindows(unsigned)).toThrow(/unsigned/);
  });
});

describe('equalOutsideSignature', () => {
  it('accepts an identical file', () => {
    const a = macho({ code, sig: Buffer.alloc(64, 1) });
    expect(equalOutsideSignature(a, Buffer.from(a))).toBe(true);
  });
  it('accepts a re-signed file: different blob, blob size and __LINKEDIT sizes', () => {
    const a = macho({ code, sig: Buffer.alloc(64, 1) });
    const b = macho({ code, sig: Buffer.alloc(96, 2) });
    expect(a.equals(b)).toBe(false);
    expect(equalOutsideSignature(a, b)).toBe(true);
  });
  it('rejects a single differing code byte — the patch reverted', () => {
    const stock = Buffer.from(code);
    stock.write('00008052c0035fd6', 0, 'hex');
    const a = macho({ code, sig: Buffer.alloc(64, 1) });
    const b = macho({ code: stock, sig: Buffer.alloc(64, 1) });
    expect(equalOutsideSignature(a, b)).toBe(false);
  });
  it('rejects code of a different length', () => {
    const a = macho({ code, sig: Buffer.alloc(64, 1) });
    const b = macho({ code: Buffer.concat([code, Buffer.alloc(8)]), sig: Buffer.alloc(64, 1) });
    expect(equalOutsideSignature(a, b)).toBe(false);
  });
  it('rejects a different load-command layout', () => {
    const a = macho({ code, sig: Buffer.alloc(64, 1) });
    const b = macho({ code, sig: Buffer.alloc(64, 1), extraSeg: true });
    expect(equalOutsideSignature(a, b)).toBe(false);
  });
});
