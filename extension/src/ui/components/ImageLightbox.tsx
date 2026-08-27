import { useEffect, useRef } from 'react';
import { translations, type Language } from './LanguageMenu';

export type LightboxImage = { dataUrl: string; title: string };

export function ImageLightbox({ image, language, onClose }: { image: LightboxImage; language: Language; onClose(): void }) {
  const t = translations[language];
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    window.parent.postMessage({ source: 'chartviz', type: 'image-lightbox-open' }, '*');
    return () => window.parent.postMessage({ source: 'chartviz', type: 'image-lightbox-close' }, '*');
  }, []);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);
  return <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={image.title} onClick={onClose}>
    <button ref={closeRef} type="button" className="lightbox-close" aria-label={t.close} onClick={(event) => { event.stopPropagation(); onClose(); }}>×</button>
    <img src={image.dataUrl} alt={image.title} onClick={(event) => event.stopPropagation()} />
  </div>;
}
