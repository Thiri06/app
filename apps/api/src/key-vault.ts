import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from './env.js';

export type Provider = 'gemini' | 'grok';
type Ciphertext = { iv: string; tag: string; data: string };
type Store = Record<string, Partial<Record<Provider, Ciphertext>>>;
const file = path.join(dataDir, 'keys.json');
function masterKey() {
  const key = process.env.KEY_ENCRYPTION_SECRET;
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) throw new Error('KEY_ENCRYPTION_SECRET must be a 32-byte hex value.');
  return Buffer.from(key, 'hex');
}
function seal(value: string): Ciphertext {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function open(value: Ciphertext) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
}
async function load(): Promise<Store> { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; } }
async function persist(store: Store) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(store), 'utf8'); }
export async function saveKeys(userId: string, provider: Provider, keys: string[]) {
  const store = await load(); store[userId] ??= {}; store[userId][provider] = seal(JSON.stringify(keys)); await persist(store);
}
export async function getKeys(userId: string, provider: Provider) {
  const stored = (await load())[userId]?.[provider]; return stored ? JSON.parse(open(stored)) as string[] : [];
}
export async function keyStatus(userId: string) {
  const record = (await load())[userId] ?? {}; return { gemini: Boolean(record.gemini), grok: Boolean(record.grok) };
}
