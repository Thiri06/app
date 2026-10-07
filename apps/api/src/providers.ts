import type { Provider } from './key-vault.js';

export type Subtitle = { id: number; startTime: string; endTime: string; originalText: string; translatedText?: string };
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
const freeVideoModels = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
const prompt = (lines: string[], genre: string, rules: string) => `Translate each subtitle string into natural Burmese for a ${genre} production. Preserve line breaks inside an item. Return ONLY a JSON array of strings in exactly the same order. ${rules ? `Additional rules: ${rules}` : ''}\n\n${JSON.stringify(lines)}`;
const subtitleSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'INTEGER' },
      startTime: { type: 'STRING' },
      endTime: { type: 'STRING' },
      originalText: { type: 'STRING' },
      translatedText: { type: 'STRING' },
    },
    propertyOrdering: ['id', 'startTime', 'endTime', 'originalText', 'translatedText'],
  },
};
function parseTranslations(value: string, expected: number) {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length !== expected || !parsed.every(item => typeof item === 'string')) throw new Error('Provider returned an invalid translation payload.');
  return parsed as string[];
}
async function providerError(name: string, response: Response) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text) as { error?: { message?: string } };
    return `${name}: ${payload.error?.message ?? text}`;
  } catch {
    return `${name}: ${text}`;
  }
}
function rateLimitHeaders(response: Response) {
  const headers: Record<string, string> = {};
  for (const name of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after', 'x-goog-quota-project']) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}
async function gemini(key: string, model: string, text: string) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseMimeType: 'application/json' } }) });
  if (!response.ok) throw new Error(await providerError('Gemini', response));
  const data = await response.json() as any; return data.candidates?.[0]?.content?.parts?.[0]?.text as string;
}
async function geminiMedia(key: string, model: string, payload: { base64: string; mimeType: string; audioLanguage: string; outputStyle: string; genre: string; customRules: string }) {
  const instruction = `You are a professional subtitler. Listen to the provided media and generate timestamped SRT subtitle entries.
Genre: ${payload.genre}
Spoken language hint: ${payload.audioLanguage}
Output style: ${payload.outputStyle === 'dual' ? 'original spoken text followed by Burmese translation' : payload.outputStyle === 'original' ? 'original spoken language only' : 'natural Burmese translation'}
${payload.customRules ? `Additional rules: ${payload.customRules}` : ''}

Return strictly valid JSON. Each item must include id, startTime, endTime, originalText, and translatedText. Use SRT timestamps like 00:00:12,340.`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Generate timestamped subtitles from this media file.' }, { inlineData: { mimeType: payload.mimeType, data: payload.base64 } }] }],
      systemInstruction: { parts: [{ text: instruction }] },
      generationConfig: { responseMimeType: 'application/json', responseSchema: subtitleSchema },
    }),
  });
  if (!response.ok) throw new Error(await providerError('Gemini', response));
  const data = await response.json() as any;
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text as string,
    usage: {
      model,
      provider: 'gemini',
      requestCount: 1,
      promptTokenCount: data.usageMetadata?.promptTokenCount,
      candidatesTokenCount: data.usageMetadata?.candidatesTokenCount,
      totalTokenCount: data.usageMetadata?.totalTokenCount,
      rateLimitHeaders: rateLimitHeaders(response),
      measuredAt: new Date().toISOString(),
    } satisfies ModelUsage,
  };
}
async function grok(key: string, model: string, text: string) {
  const response = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'system', content: 'Return only valid JSON.' }, { role: 'user', content: text }], temperature: 0.2 }) });
  if (!response.ok) throw new Error(await providerError('Grok', response));
  const data = await response.json() as any; return data.choices?.[0]?.message?.content as string;
}
export async function translate(provider: Provider, keys: string[], model: string, subtitles: Subtitle[], settings: { genre: string; customRules: string }) {
  const chunks = Array.from({ length: Math.ceil(subtitles.length / 30) }, (_, index) => subtitles.slice(index * 30, index * 30 + 30));
  const output: Subtitle[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const batch = chunks[index]; let lastError: unknown;
    for (const key of keys) try {
      const body = prompt(batch.map(item => item.originalText), settings.genre, settings.customRules);
      const response = provider === 'gemini' ? await gemini(key, model, body) : await grok(key, model, body);
      const translations = parseTranslations(response, batch.length);
      output.push(...batch.map((item, position) => ({ ...item, translatedText: translations[position] })));
      lastError = null; break;
    } catch (error) { lastError = error; }
    if (lastError) throw lastError;
  }
  return output;
}
export async function generateSrtFromMedia(keys: string[], model: string, payload: { base64: string; mimeType: string; audioLanguage: string; outputStyle: string; genre: string; customRules: string }) {
  let lastError: unknown;
  const models = [model, ...freeVideoModels.filter(candidate => candidate !== model)];
  for (const candidate of models) {
    for (const key of keys) try {
      const response = await geminiMedia(key, candidate, payload);
      const parsed: unknown = JSON.parse(response.text);
      if (!Array.isArray(parsed)) throw new Error('Gemini returned an invalid subtitle payload.');
      return {
        subtitles: parsed.map((item, index) => ({
          id: typeof item.id === 'number' ? item.id : index + 1,
          startTime: String(item.startTime ?? ''),
          endTime: String(item.endTime ?? ''),
          originalText: String(item.originalText ?? ''),
          translatedText: String(item.translatedText ?? item.originalText ?? ''),
        })) satisfies Subtitle[],
        usage: response.usage,
      };
    } catch (error) { lastError = error; }
  }
  throw lastError;
}
