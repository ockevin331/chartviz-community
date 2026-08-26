import type { ProcessedImage } from './image-types';
import { processImage } from './process-image';

type ImageProcessor = (input: Blob) => Promise<ProcessedImage>;

export function readManualUpload(file: File, processor?: ImageProcessor): Promise<ProcessedImage>;
export function readManualUpload(
  files: FileList | readonly File[],
  processor?: ImageProcessor,
): Promise<ProcessedImage>;
export async function readManualUpload(
  selection: File | FileList | readonly File[],
  processor: ImageProcessor = processImage,
): Promise<ProcessedImage> {
  const files = selection instanceof Blob ? [selection] : Array.from(selection);
  const file = files[0];
  if (files.length !== 1 || !file) {
    throw new Error('Select exactly one image');
  }

  return processor(file);
}
