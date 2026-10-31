import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupWriter, encryptWithWriter, decryptBackup } from '../js/backup-crypto.js';
import { writeFolderBackup, validateCloudConfig, parseEncryptedBundle, restoreCloudBundle } from '../js/data-services.js';
import * as store from '../js/store.js';
import { zipBytes } from '../js/xlsx.js';

test('the persisted backup writer cannot decrypt or export its key; backups still open with the password', async () => {
  const password = 'Kenz-backup-2026';
  const writer = await createBackupWriter(password, { iter: 1000 });
  assert.deepEqual(writer.key.usages, ['encrypt']);
  await assert.rejects(() => crypto.subtle.exportKey('raw', writer.key));
  const a = await encryptWithWriter(new Uint8Array([1, 2, 3]), structuredClone(writer), { kind: 'zip' });
  const b = await encryptWithWriter(new Uint8Array([1, 2, 3]), writer, { kind: 'zip' });
  assert.notEqual(JSON.parse(a).iv, JSON.parse(b).iv);
  assert.deepEqual((await decryptBackup(a, password)).bytes, new Uint8Array([1, 2, 3]));
  await assert.rejects(() => crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, writer.key, new Uint8Array(16)));
});

test('folder backups are company-specific, encrypted, and committed only when the stream closes', async () => {
  const writer = await createBackupWriter('Kenz-backup-2026', { iter: 1000 });
  const saved = []; let pending, closed = false;
  const directory = { async getFileHandle(name) { saved.push(name); return { async createWritable() { return { async write(text) { pending = text; }, async close() { closed = true; }, async abort() {} }; } }; } };
  const bytes = new Uint8Array([80, 75, 1, 2]);
  await writeFolderBackup(directory, writer, bytes, 'company1', new Date(2026, 9, 31, 1));
  assert.equal(saved[0], 'kenz-company1-2026-10-31.json');
  assert.equal(closed, true);
  assert.equal(pending.includes('company1'), false);
  assert.deepEqual((await decryptBackup(pending, 'Kenz-backup-2026')).bytes, bytes);
  let aborted = false;
  const broken = { async getFileHandle() { return { async createWritable() { return { async write() { throw new Error('disk full'); }, async abort() { aborted = true; } }; } }; } };
  await assert.rejects(() => writeFolderBackup(broken, writer, bytes), /disk full/);
  assert.equal(aborted, true);
});

test('cloud URLs cannot leak credentials over HTTP or inject endpoint paths', () => {
  assert.deepEqual(validateCloudConfig('https://kenz.example', 'shop1'), { url: 'https://kenz.example', space: 'shop1' });
  for (const url of ['http://kenz.example', 'https://user:secret@kenz.example', 'https://kenz.example/other', 'https://kenz.example/?x=1']) assert.throws(() => validateCloudConfig(url, 'shop1'));
  for (const key of ['../db', 'a', 'shop/other']) assert.throws(() => validateCloudConfig('https://kenz.example', key));
});

test('cloud restore validates every attachment and refuses replacement if the safety snapshot cannot be saved', async () => {
  store.createCompany({ name: 'Local protected data' });
  const local = store.getDb();
  const remote = { ...local, settings: { ...local.settings, name: 'Remote' }, docs: [{ id: 'remote1', type: 'journal', files: [{ id: 'file123', name: 'invoice.pdf', type: 'application/pdf' }] }] };
  const writer = await createBackupWriter('Kenz-backup-2026', { iter: 1000 });
  const records = [{ name: 'ahsebha-backup.json', data: JSON.stringify(remote) }];
  const missing = await encryptWithWriter(zipBytes(records), writer, { kind: 'zip' });
  await assert.rejects(() => parseEncryptedBundle(missing, 'Kenz-backup-2026'), /تفتقد مرفقاً/);
  records.push({ name: 'files/file123', data: new Uint8Array([1, 2, 3]) });
  const full = await encryptWithWriter(zipBytes(records), writer, { kind: 'zip' });
  const parsed = await parseEncryptedBundle(full, 'Kenz-backup-2026');
  assert.equal(parsed.data.settings.name, 'Remote');
  assert.deepEqual(parsed.files.get('file123').bytes, new Uint8Array([1, 2, 3]));
  await assert.rejects(() => restoreCloudBundle(parsed)); // لا يوجد IndexedDB في هذا الفحص
  assert.equal(store.getDb(), local);
  assert.equal(store.getDb().settings.name, 'Local protected data');
});
