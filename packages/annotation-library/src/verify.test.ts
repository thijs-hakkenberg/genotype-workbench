import { describe, expect, it } from 'vitest';
import { sha256Hex, verifyIndexSignature } from './verify';

const toB64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));

describe('pack index integrity', () => {
  it('accepts a correctly signed index and rejects a tampered one', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = toB64(await crypto.subtle.exportKey('raw', pair.publicKey));
    const index = new TextEncoder().encode('{"packs":[]}\n');
    const sig = toB64(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, index));
    expect(await verifyIndexSignature(index, sig, pub)).toBe(true);
    const tampered = new TextEncoder().encode('{"packs":[1]}\n');
    expect(await verifyIndexSignature(tampered, sig, pub)).toBe(false);
  });

  it('hashes like sha256sum', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
