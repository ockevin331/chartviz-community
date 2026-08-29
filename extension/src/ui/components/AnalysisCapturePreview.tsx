import type { AnalysisCapture } from '../../analysis/runtime/analysis-runtime';
import { AnnotatedImage } from './AnnotatedImage';
import { translations, type Language } from './LanguageMenu';
import type { LightboxImage } from './ImageLightbox';

function roleLabel(index: number, count: number, language: Language): string | null {
  if (count === 1) return null;
  const t = translations[language];
  if (count === 2) return index === 0 ? t.contextRole : t.triggerRole;
  return [t.contextRole, t.setupRole, t.triggerRole][index] ?? null;
}

export function AnalysisCapturePreview({
  language,
  captures,
  analyzing = false,
  onZoom,
}: {
  language: Language;
  captures: readonly AnalysisCapture[];
  analyzing?: boolean;
  onZoom(image: LightboxImage): void;
}) {
  const t = translations[language];
  return <section className="analysis-capture-preview">
    <h2>{t.preview}</h2>
    <div className={captures.length > 1 ? 'capture-preview-list multi' : 'capture-preview-list'}>
      {captures.map((capture, index) => {
        const role = roleLabel(index, captures.length, language);
        const timeframe = capture.context.timeframe || t.notDetected;
        const title = role ? `${role} · ${timeframe}` : t.previewAlt;
        return <article className="capture-preview-item" key={`${timeframe}-${index}`}>
          {role && <strong>{title}</strong>}
          <div className={analyzing ? 'is-analyzing' : ''}>
            <AnnotatedImage
              language={language}
              image={{ dataUrl: capture.image.dataUrl, title }}
              filename={`chartviz-${timeframe}.png`}
              onZoom={onZoom}
              showDownload={!analyzing}
            />
            {analyzing && <div className="analysis-mask" aria-hidden="true"><div className="scan-beam" /></div>}
          </div>
        </article>;
      })}
    </div>
  </section>;
}
