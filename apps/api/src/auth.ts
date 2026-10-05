import crypto from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from './env.js';

const usersPath = path.join(dataDir, 'users.json');
type User = { id: string; email: string; password: string };

async function users(): Promise<User[]> {
  try { return JSON.parse(await readFile(usersPath, 'utf8')); } catch { return []; }
}
async function save(usersToSave: User[]) { await mkdir(dataDir, { recursive: true }); await writeFile(usersPath, JSON.stringify(usersToSave), 'utf8'); }
function hash(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function matches(password: string, stored: string) {
  const [salt, digest] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hash(password, salt).split(':')[1], 'hex'));
}
function secret() { const value = process.env.AUTH_TOKEN_SECRET; if (!value) throw new Error('AUTH_TOKEN_SECRET is required'); return value; }
export function tokenFor(userId: string) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
export function userFromToken(value?: string) {
  if (!value?.startsWith('Bearer ')) return null;
  const [payload, signature] = value.slice(7).split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const actual = Buffer.from(signature);
  const target = Buffer.from(expected);
  if (actual.length !== target.length || !crypto.timingSafeEqual(actual, target)) return null;
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return parsed.exp > Date.now() ? parsed.sub as string : null;
}
export async function userProfile(userId: string) {
  const user = (await users()).find(item => item.id === userId);
  return user ? { id: user.id, email: user.email } : null;
}
export async function register(email: string, password: string) {
  const all = await users();
  if (all.some(user => user.email === email.toLowerCase())) throw new Error('An account with this email already exists.');
  const user = { id: crypto.randomUUID(), email: email.toLowerCase(), password: hash(password) };
  await save([...all, user]);
  return tokenFor(user.id);
}
export async function login(email: string, password: string) {
  const user = (await users()).find(item => item.email === email.toLowerCase());
  if (!user || !matches(password, user.password)) throw new Error('Incorrect email or password.');
  return tokenFor(user.id);
}
