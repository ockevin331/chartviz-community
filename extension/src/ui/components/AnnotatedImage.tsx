import { downloadImage as defaultDownloadImage } from '../export/download-image';
import { translations, type Language } from './LanguageMenu';
import type { LightboxImage } from './ImageLightbox';

type Props = {
  language: Language;
  image: LightboxImage;
  filename: string;
  onZoom(image: LightboxImage): void;
  downloadImage?: (dataUrl: string, filename: string) => void;
  showDownload?: boolean;
};

export function AnnotatedImage({ language, image, filename, onZoom, downloadImage = defaultDownloadImage, showDownload = true }: Props) {
  const t = translations[language];
  return <div className="annotated-image">
    <button type="button" className="preview-stage zoomable" aria-label={`${t.zoom}: ${image.title}`} onClick={() => onZoom(image)}><img className="preview" src={image.dataUrl} alt={image.title} /></button>
    {showDownload && <button type="button" className="secondary download-image" aria-label={`${t.download}: ${image.title}`} onClick={() => downloadImage(image.dataUrl, filename)}>{t.download}</button>}
  </div>;
}
