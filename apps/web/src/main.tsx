import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { authenticate, authenticated, generateVideoSrt, keyStatus, logout, me, saveKeys, translate, type ModelUsage } from './api';
import { exportSrt, parseSrt, type Subtitle } from './srt';
import './styles.css';

const modelDefaults = { gemini: 'gemini-3.8-flash', grok: 'grok-4.7' } as const;
const studioKeyUrl = 'https://aistudio.google.com/apikey';
type Mode = 'translate' | 'video';

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the selected media file.'));
    reader.readAsDataURL(file);
  });
}

function Auth({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      setError('');
      await authenticate(mode, email, password);
      onAuthenticated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not authenticate.');
    }
  }

  return (
    <main className="auth">
      <form onSubmit={submit}>
        <h1>Burmese Subtitles</h1>
        <p>Sign in with the same email you will use in Google AI Studio.</p>
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" minLength={10} value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        <button>{mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
        </button>
      </form>
    </main>
  );
}

function App() {
  const [signedIn, setSignedIn] = useState(authenticated());
  const [profileEmail, setProfileEmail] = useState('');
  const [mode, setMode] = useState<Mode>('translate');
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [fileName, setFileName] = useState('translated.srt');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [provider, setProvider] = useState<'gemini' | 'grok'>('gemini');
  const [model, setModel] = useState<string>(modelDefaults.gemini);
  const [keys, setKeys] = useState('');
  const [status, setStatus] = useState<{ gemini: boolean; grok: boolean }>({ gemini: false, grok: false });
  const [genre, setGenre] = useState('Drama');
  const [rules, setRules] = useState('');
  const [audioLanguage, setAudioLanguage] = useState('auto');
  const [outputStyle, setOutputStyle] = useState<'burmese' | 'dual' | 'original'>('burmese');
  const [message, setMessage] = useState('');
  const [lastVideoUsage, setLastVideoUsage] = useState<ModelUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoElapsed, setVideoElapsed] = useState(0);
  const [videoPhase, setVideoPhase] = useState('');

  const mediaUrl = useMemo(() => mediaFile && mode === 'video' ? URL.createObjectURL(mediaFile) : '', [mediaFile, mode]);

  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);
  useEffect(() => {
    if (!busy || mode !== 'video') return;
    setVideoProgress(12);
    setVideoElapsed(0);
    setVideoPhase('Preparing media payload...');
    const timer = window.setInterval(() => {
      setVideoElapsed(value => {
        const next = value + 1;
        if (next > 45) setVideoPhase('Finalizing timestamped subtitles...');
        else if (next > 25) setVideoPhase('Generating Burmese subtitle lines...');
        else if (next > 10) setVideoPhase('Gemini is analyzing speech and timing...');
        return next;
      });
      setVideoProgress(value => Math.min(92, value + (value < 50 ? 3 : value < 80 ? 2 : 1)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [busy, mode]);

  async function refreshSession() {
    try {
      const [profile, keysSaved] = await Promise.all([me(), keyStatus()]);
      setProfileEmail(profile.email);
      setStatus(keysSaved);
    } catch {
      logout();
      setSignedIn(false);
    }
  }

  useEffect(() => {
    if (signedIn) refreshSession();
  }, [signedIn]);

  function switchMode(next: Mode) {
    setMode(next);
    setMessage(next === 'translate' ? 'SRT translation mode selected.' : 'Video-to-SRT mode selected. Gemini keys are required.');
    if (next === 'video') {
      setProvider('gemini');
      setModel(modelDefaults.gemini);
    }
  }

  function selectFile(file?: File) {
    if (!file) return;
    const isMedia = file.type.startsWith('video/') || file.type.startsWith('audio/');
    if (isMedia) {
      setMediaFile(file);
      setSubtitles([]);
      setFileName(file.name.replace(/\.[^.]+$/, '') + '_burmese.srt');
      switchMode('video');
      setMessage(`${file.name} loaded for video-to-SRT generation.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseSrt(String(reader.result));
      if (!parsed.length) return setMessage('No valid SRT cues found.');
      setMediaFile(null);
      setSubtitles(parsed);
      setFileName(file.name.replace(/\.[^.]+$/, '') + '_burmese.srt');
      switchMode('translate');
      setMessage(`${parsed.length} subtitle cues loaded.`);
    };
    reader.readAsText(file);
  }

  async function storeKeys() {
    try {
      const pool = keys.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      if (!pool.length) throw new Error('Enter at least one API key.');
      await saveKeys(provider, pool);
      setKeys('');
      await refreshSession();
      setMessage(`${provider === 'gemini' ? 'Gemini' : 'Grok'} keys saved securely.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not save keys.');
    }
  }

  async function runTranslation() {
    if (!subtitles.length) return setMessage('Upload an SRT file first.');
    setBusy(true);
    setMessage('Translating subtitles...');
    try {
      const result = await translate({ provider, model, subtitles, settings: { genre, customRules: rules } });
      setSubtitles(result.subtitles);
      setMessage('Translation complete. Review and download the SRT.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Translation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runVideoGeneration() {
    if (!mediaFile) return setMessage('Upload a video or audio file first.');
    if (!status.gemini) return setMessage('Save a Gemini API key before generating SRT from video.');
    if (mediaFile.size > 45 * 1024 * 1024) return setMessage('For this first version, use media files under 45 MB.');
    setBusy(true);
    setVideoProgress(8);
    setVideoElapsed(0);
    setVideoPhase('Reading media file...');
    setMessage('Reading media and asking Gemini to create timestamped subtitles...');
    try {
      const base64 = await fileToBase64(mediaFile);
      setVideoProgress(value => Math.max(value, 18));
      setVideoPhase('Uploading media to Gemini...');
      const result = await generateVideoSrt({
        model: modelDefaults.gemini,
        base64,
        mimeType: mediaFile.type || 'video/mp4',
        settings: { audioLanguage, outputStyle, genre, customRules: rules },
      });
      setSubtitles(result.subtitles);
      setLastVideoUsage(result.usage);
      setVideoProgress(100);
      setVideoPhase('Complete');
      setMessage(`Generated ${result.subtitles.length} subtitle cues. Review and download the SRT.`);
    } catch (reason) {
      setVideoPhase('Failed');
      setMessage(reason instanceof Error ? reason.message : 'Video-to-SRT generation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runMainAction() {
    if (mode === 'video') return runVideoGeneration();
    return runTranslation();
  }

  if (!signedIn) return <Auth onAuthenticated={() => setSignedIn(true)} />;

  return (
    <main className="workspace">
      <header className="topbar">
        <div><h1>Burmese SRT</h1><p>AI subtitle translator and video-to-SRT workspace</p></div>
        <button className="secondary" onClick={() => { logout(); setSignedIn(false); }}>Sign out</button>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <section className="card">
            <label className="eyebrow">Translation Mode</label>
            <div className="segmented">
              <button className={mode === 'translate' ? 'active' : ''} onClick={() => switchMode('translate')}>Translate SRT</button>
              <button className={mode === 'video' ? 'active' : ''} onClick={() => switchMode('video')}>Video to SRT</button>
            </div>
          </section>

          {mode === 'video' && (
            <section className="card">
              <label className="eyebrow">Video Speech Options</label>
              <label>Spoken language
                <select value={audioLanguage} onChange={e => setAudioLanguage(e.target.value)}>
                  <option value="auto">Auto-detect</option><option>English</option><option>Korean</option><option>Japanese</option><option>Chinese</option><option>Thai</option><option>Burmese</option>
                </select>
              </label>
              <label>Generated output
                <select value={outputStyle} onChange={e => setOutputStyle(e.target.value as typeof outputStyle)}>
                  <option value="burmese">Direct Burmese translation</option>
                  <option value="dual">Bilingual original + Burmese</option>
                  <option value="original">Original spoken language only</option>
                </select>
              </label>
            </section>
          )}

          <section className="card">
            <label className="eyebrow">AI Model Engine</label>
            <div className="row">
              <label>Provider
                <select value={provider} disabled={mode === 'video'} onChange={e => { const next = e.target.value as 'gemini' | 'grok'; setProvider(next); setModel(modelDefaults[next]); }}>
                  <option value="gemini">Google Gemini</option>
                  <option value="grok">xAI Grok</option>
                </select>
              </label>
              <label>Model<input value={mode === 'video' ? modelDefaults.gemini : model} onChange={e => setModel(e.target.value)} disabled={mode === 'video'} /></label>
            </div>
            <p className="muted">{mode === 'video' ? 'Video generation uses Gemini multimodal input.' : 'SRT translation can use Gemini or Grok.'}</p>
          </section>

          <section className="card key-card">
            <label className="eyebrow">Gemini Key Setup</label>
            <p className="muted">App account: <strong>{profileEmail}</strong></p>
            <p className="muted">Use the same Google account in AI Studio when creating your Gemini API key.</p>
            <a className="external" href={studioKeyUrl} target="_blank" rel="noreferrer">Create Gemini API key in Google AI Studio</a>
            <p className="notice">Google AI Studio and Gemini API are region-limited. Use an eligible account and network location; VPN use must comply with Google terms and local rules.</p>
            <textarea value={keys} onChange={e => setKeys(e.target.value)} placeholder="Paste one API key per line" aria-label="API key pool" />
            <button onClick={storeKeys}>Save {provider} key pool</button>
            <p className="muted">{status[provider] ? 'A key pool is saved for this provider.' : 'No key saved for this provider.'}</p>
          </section>

          <section className="card">
            <label className="eyebrow">Context & Formatting Rules</label>
            <label>Genre
              <select value={genre} onChange={e => setGenre(e.target.value)}>
                <option>Drama</option><option>Action</option><option>Comedy</option><option>Romance</option><option>Documentary</option><option>Kdrama</option><option>Anime</option><option>Horror</option><option>Historical</option><option>Crime</option>
              </select>
            </label>
            <label>Custom rules<textarea value={rules} onChange={e => setRules(e.target.value)} placeholder="Example: keep character names in English, use polite Burmese tone" /></label>
          </section>

          <button className="primary-action" disabled={busy} onClick={runMainAction}>
            {busy ? 'Working...' : mode === 'video' ? 'Generate SRT from Video' : 'Translate to Burmese'}
          </button>
        </aside>

        <section className="workarea">
          <div className="dropzone" onClick={() => document.getElementById('fileInput')?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); selectFile(e.dataTransfer.files[0]); }}>
            <input id="fileInput" type="file" accept=".srt,.vtt,.txt,.mp4,.mkv,.avi,.webm,.mp3,.wav,.m4a" onChange={e => selectFile(e.target.files?.[0])} />
            <h2>{mode === 'video' ? 'Drop video/audio here' : 'Drop subtitle file here'}</h2>
            <p>{mode === 'video' ? 'Supports MP4, MKV, WEBM, MP3, WAV, and M4A for Gemini video-to-SRT generation.' : 'Supports SRT, VTT, and TXT subtitle files for Burmese translation.'}</p>
            {(mediaFile || subtitles.length > 0) && <span>{mediaFile?.name ?? `${subtitles.length} subtitle cues loaded`}</span>}
          </div>

          {mediaUrl && <video className="preview" src={mediaUrl} controls />}

          <div className="progress-card">
            <span>{message || 'Upload an SRT file or video to begin.'}</span>
            <span>{subtitles.length} cues</span>
          </div>

          {(mode === 'video' && (busy || videoProgress > 0)) && (
            <section className={`model-progress ${videoPhase === 'Failed' ? 'failed' : ''}`}>
              <div className="progress-meta">
                <span>{videoPhase || 'Waiting to start...'}</span>
                <span>{videoProgress}% · {videoElapsed}s elapsed</span>
              </div>
              <div className="progress-track" aria-label="Video-to-SRT progress" aria-valuenow={videoProgress} aria-valuemin={0} aria-valuemax={100} role="progressbar">
                <div style={{ width: `${videoProgress}%` }} />
              </div>
              <p>{busy ? 'Estimated progress while Gemini processes the media. Exact completion depends on file length, model load, and account limits.' : videoPhase === 'Complete' ? 'Generation finished.' : 'Ready for the next generation.'}</p>
            </section>
          )}

          {lastVideoUsage && (
            <section className="usage-card">
              <div>
                <h2>Last Video-to-SRT AI Usage</h2>
                <p>Measured after the most recent Gemini media generation.</p>
              </div>
              <dl>
                <div><dt>Model</dt><dd>{lastVideoUsage.model}</dd></div>
                <div><dt>Requests used</dt><dd>{lastVideoUsage.requestCount}</dd></div>
                <div><dt>Prompt tokens</dt><dd>{lastVideoUsage.promptTokenCount ?? 'Not returned'}</dd></div>
                <div><dt>Output tokens</dt><dd>{lastVideoUsage.candidatesTokenCount ?? 'Not returned'}</dd></div>
                <div><dt>Total tokens</dt><dd>{lastVideoUsage.totalTokenCount ?? 'Not returned'}</dd></div>
                <div><dt>Measured at</dt><dd>{new Date(lastVideoUsage.measuredAt).toLocaleString()}</dd></div>
              </dl>
              {Object.keys(lastVideoUsage.rateLimitHeaders).length > 0 ? (
                <div className="headers">
                  {Object.entries(lastVideoUsage.rateLimitHeaders).map(([name, value]) => <span key={name}>{name}: {value}</span>)}
                </div>
              ) : (
                <p className="muted">Gemini did not return remaining quota headers for this request. Open AI Studio Rate Limits for the authoritative remaining quota for your account/tier.</p>
              )}
              <a className="external" href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer">Open AI Studio usage and rate limits</a>
            </section>
          )}

          <section className="editor">
            <div className="editor-head">
              <div><h2>Subtitle Line Inspector</h2><p>Original text and editable Burmese output</p></div>
              <button className="secondary" disabled={!subtitles.length} onClick={() => download(fileName, exportSrt(subtitles))}>Export SRT</button>
            </div>
            <div className="columns"><span>Original Text & Timestamp</span><span>Burmese AI Translation</span></div>
            <div className="cues">
              {!subtitles.length && <p className="empty">No subtitle file generated or loaded yet.</p>}
              {subtitles.map((sub, index) => (
                <article key={`${sub.id}-${index}`} className="cue">
                  <div><small>{sub.startTime} -&gt; {sub.endTime}</small><p>{sub.originalText}</p></div>
                  <textarea value={sub.translatedText ?? ''} placeholder="Burmese translation" onChange={e => setSubtitles(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, translatedText: e.target.value } : item))} />
                </article>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
