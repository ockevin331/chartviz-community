export type AnnotatedImage = {
  id: string;
  kind: 'levels' | 'signal' | 'pattern' | 'structure';
  title: string;
  dataUrl: string;
  width: number;
  height: number;
};

export type AnnotatedReportImages = {
  levels: AnnotatedImage | null;
  signals: Record<string, AnnotatedImage>;
  patterns: Record<string, AnnotatedImage>;
};

export type PresentationAnnotatedImages = {
  structure: Record<string, AnnotatedImage>;
  levels: Record<string, AnnotatedImage>;
  signals: Record<string, AnnotatedImage>;
  patterns: Record<string, AnnotatedImage>;
};
