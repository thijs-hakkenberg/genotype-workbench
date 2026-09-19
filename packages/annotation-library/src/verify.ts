/** Integrity checks for the Pack Index: Ed25519 over the index bytes, SHA-256 per pack. */

const b64 = (s: string) => Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0));

export async function verifyIndexSignature(indexBytes: Uint8Array, signatureB64: string, publicKeyB64: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', b64(publicKeyB64), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'Ed25519' }, key, b64(signatureB64), indexBytes as Uint8Array<ArrayBuffer>);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
