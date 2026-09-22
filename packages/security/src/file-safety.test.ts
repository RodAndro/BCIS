import { describe, expect, it } from 'vitest';

import { magicBytesMatch, safeRelativeStoragePath } from './file-safety';

describe('file storage safety', () => {
  it('keeps relative paths inside the configured root', () => {
    expect(safeRelativeStoragePath('data/proofs', '2026/09/proof.png')).toBe('2026\\09\\proof.png');
    expect(() => safeRelativeStoragePath('data/proofs', '../secrets.txt')).toThrow(/escapes/i);
    expect(() => safeRelativeStoragePath('data/proofs', 'C:\\secrets.txt')).toThrow(/relative/i);
  });

  it('checks file signatures instead of trusting extensions', () => {
    expect(magicBytesMatch('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    expect(magicBytesMatch('image/png', new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
  });
});
