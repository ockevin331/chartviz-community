import { useRef, useState } from 'react';
import type { ProcessedImage } from '../../capture/image-types';
import { translations, type Language } from './LanguageMenu';

type Props = {
  language: Language;
  capture(signal: AbortSignal): Promise<ProcessedImage>;
  readUpload(file: File): Promise<ProcessedImage>;
  onSelected(image: ProcessedImage): void;
};

export function ImageSourcePicker({ language, capture, readUpload, onSelected }: Props) {
  const t = translations[language];
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function select(operation: () => Promise<ProcessedImage>) {
    setBusy(true); setError('');
    try { onSelected(await operation()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : t.sourceError); }
    finally { setBusy(false); }
  }
  return <section className="capture-source"><h2>{t.chooseImage}</h2><p className="muted">{t.chooseImageHelp}</p><div className="mode-switch">
    <button type="button" disabled={busy} onClick={() => void select(() => capture(new AbortController().signal))}><b>{t.capture}</b><span>TradingView</span></button>
    <button type="button" disabled={busy} onClick={() => input.current?.click()}><b>{t.upload}</b><span>PNG · JPEG · WebP</span></button>
  </div><input ref={input} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label={t.upload} onChange={(event) => { const file = event.target.files?.[0]; if (file) void select(() => readUpload(file)); }} />{error && <p className="setup-error" role="alert">{error}</p>}</section>;
}
