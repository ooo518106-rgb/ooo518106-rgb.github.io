import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { decryptBackup, encryptBytes, MIN_PASSWORD } from '../js/backup-crypto.js';

globalThis.crypto ||= webcrypto;

test('a legacy backup encrypted with a six-character password remains readable', async () => {
  const password = 'old123';
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const original = new TextEncoder().encode('legacy accounting data');
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, original));
  const b64 = (v) => Buffer.from(v).toString('base64');
  const file = JSON.stringify({ app: 'kenz-encrypted-backup', v: 1, iter: 1000, kind: 'json', salt: b64(salt), iv: b64(iv), data: b64(encrypted) });
  assert.deepEqual((await decryptBackup(file, password)).bytes, original);
});

test('the new password boundary rejects eleven and accepts twelve characters', async () => {
  assert.equal(MIN_PASSWORD, 12);
  await assert.rejects(() => encryptBytes(new Uint8Array([1]), 'a'.repeat(11), { iter: 1000 }));
  const file = await encryptBytes(new Uint8Array([1]), 'a'.repeat(12), { iter: 1000 });
  assert.deepEqual((await decryptBackup(file, 'a'.repeat(12))).bytes, new Uint8Array([1]));
});
