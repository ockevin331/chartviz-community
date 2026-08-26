import type { ProcessedImage } from '../../capture/image-types';
import { AnnotatedImage } from './AnnotatedImage';
import { translations, type Language } from './LanguageMenu';
import type { LightboxImage } from './ImageLightbox';

export function ImagePreview({ language, image, analyzing, onZoom, onAnalyze, onChange }: { language: Language; image: ProcessedImage; analyzing?: boolean; onZoom(image: LightboxImage): void; onAnalyze(): void; onChange(): void }) {
  const t = translations[language];
  return <section><h2>{t.preview}</h2><div className={analyzing ? 'is-analyzing' : ''}><AnnotatedImage language={language} image={{ dataUrl: image.dataUrl, title: t.previewAlt }} filename="chartviz-original.png" onZoom={onZoom} />{analyzing && <div className="analysis-mask" aria-hidden="true"><div className="scan-beam" /></div>}</div>{!analyzing && <div className="preview-actions"><button className="secondary" type="button" onClick={onChange}>{t.changeImage}</button><button className="primary" type="button" onClick={onAnalyze}>{t.analyze}</button></div>}</section>;
}
