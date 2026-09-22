import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

const ALLOWED_MAGIC_BYTES: Readonly<Record<string, readonly number[]>> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
};

export function safeRelativeStoragePath(root: string, candidate: string): string {
  if (isAbsolute(candidate)) throw new Error('Storage path must be relative.');
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(resolvedRoot, candidate);
  const relativePath = relative(resolvedRoot, resolvedCandidate);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.includes('\0')) {
    throw new Error('Storage path escapes the configured root.');
  }
  return normalize(relativePath);
}

export function magicBytesMatch(mimeType: string, bytes: Uint8Array): boolean {
  const signature = ALLOWED_MAGIC_BYTES[mimeType];
  if (signature === undefined || bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}
