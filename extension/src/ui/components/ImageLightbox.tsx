import { useEffect } from 'react';
import { translations, type Language } from './LanguageMenu';

export type LightboxImage = { dataUrl: string; title: string };

export function ImageLightbox({ image, language, onClose }: { image: LightboxImage; language: Language; onClose(): void }) {
  const t = translations[language];
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [onClose]);
  return <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={image.title} onClick={onClose}>
    <button type="button" className="lightbox-close" aria-label={t.close} onClick={onClose}>×</button>
    <img src={image.dataUrl} alt={image.title} onClick={(event) => event.stopPropagation()} />
  </div>;
}
