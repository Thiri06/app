export type Subtitle = { id: number; startTime: string; endTime: string; originalText: string; translatedText?: string };
export function parseSrt(input: string): Subtitle[] {
  return input.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).flatMap((block, index) => {
    const lines = block.split('\n'); const timeAt = lines[0].includes('-->') ? 0 : 1; const time = lines[timeAt];
    if (!time?.includes('-->')) return [];
    const [startTime, endTime] = time.split('-->').map(value => value.trim()); const originalText = lines.slice(timeAt + 1).join('\n').trim();
    return originalText ? [{ id: index + 1, startTime, endTime, originalText }] : [];
  });
}
export function exportSrt(subtitles: Subtitle[]) {
  return subtitles.map((item, index) => `${index + 1}\n${item.startTime} --> ${item.endTime}\n${item.translatedText?.trim() || item.originalText}\n`).join('\n');
}
