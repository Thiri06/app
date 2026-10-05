import type { Subtitle } from './srt';
const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
let token = sessionStorage.getItem('sessionToken');
export type ModelUsage = {
  model: string;
  provider: 'gemini';
  requestCount: number;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  rateLimitHeaders: Record<string, string>;
  measuredAt: string;
};
export const authenticated = () => Boolean(token);
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
  const data = response.status === 204 ? null : await response.json(); if (!response.ok) throw new Error(data?.error ?? 'Request failed.'); return data;
}
export async function authenticate(action: 'login' | 'register', email: string, password: string) { const data = await request(`/v1/auth/${action}`, { method: 'POST', body: JSON.stringify({ email, password }) }); token = data.token; sessionStorage.setItem('sessionToken', token!); }
export function logout() { token = null; sessionStorage.removeItem('sessionToken'); }
export function me() { return request('/v1/me') as Promise<{ id: string; email: string }>; }
export function saveKeys(provider: 'gemini' | 'grok', keys: string[]) { return request('/v1/keys', { method: 'PUT', body: JSON.stringify({ provider, keys }) }); }
export function keyStatus() { return request('/v1/keys') as Promise<{ gemini: boolean; grok: boolean }>; }
export function translate(payload: { provider: 'gemini' | 'grok'; model: string; subtitles: Subtitle[]; settings: { genre: string; customRules: string } }) { return request('/v1/translations/srt', { method: 'POST', body: JSON.stringify(payload) }) as Promise<{ subtitles: Subtitle[] }>; }
export function generateVideoSrt(payload: { model: string; base64: string; mimeType: string; settings: { audioLanguage: string; outputStyle: 'burmese' | 'dual' | 'original'; genre: string; customRules: string } }) { return request('/v1/generations/video-srt', { method: 'POST', body: JSON.stringify(payload) }) as Promise<{ subtitles: Subtitle[]; usage: ModelUsage }>; }
