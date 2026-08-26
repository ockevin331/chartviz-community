import { describe, expect, it, vi } from 'vitest';
import type { ProcessedImage } from '../src/capture/image-types';
import { readManualUpload } from '../src/capture/manual-upload';

const processed: ProcessedImage = {
  mediaType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,cHJvY2Vzc2Vk',
  width: 640,
  height: 480,
};

function file(name: string, mediaType = 'image/png'): File {
  return Object.assign(new Blob(['pixels'], { type: mediaType }), {
    name,
    lastModified: 0,
  }) as File;
}

describe('readManualUpload', () => {
  it('processes exactly one selected file and returns its processed image', async () => {
    const selected = file('chart.png');
    const processor = vi.fn(async () => processed);

    await expect(readManualUpload([selected], processor)).resolves.toEqual(processed);
    expect(processor).toHaveBeenCalledWith(selected);
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it.each([
    { selection: [] as File[] },
    { selection: [file('first.png'), file('second.webp', 'image/webp')] },
  ])('rejects a selection containing anything other than one file', async ({ selection }) => {
    const processor = vi.fn(async () => processed);

    await expect(readManualUpload(selection, processor)).rejects.toThrow('exactly one image');
    expect(processor).not.toHaveBeenCalled();
  });

  it('supports the single-File interface directly', async () => {
    const selected = file('chart.jpg', 'image/jpeg');
    const processor = vi.fn(async () => processed);

    await expect(readManualUpload(selected, processor)).resolves.toEqual(processed);
    expect(processor).toHaveBeenCalledWith(selected);
  });
});
