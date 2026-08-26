import { describe, expect, it, vi } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  processImage,
  type ImageProcessingDependencies,
} from '../src/capture/process-image';

function createDependencies(options: {
  width?: number;
  height?: number;
  transparent?: boolean;
  decodeError?: Error;
  outputDataUrl?: string;
} = {}) {
  const encode = vi.fn(async (mediaType: 'image/png' | 'image/jpeg', quality?: number) => (
    new Blob([mediaType === 'image/png' ? 'fresh-png' : 'fresh-jpeg'], { type: mediaType })
  ));
  const draw = vi.fn();
  const dispose = vi.fn();
  const dependencies: ImageProcessingDependencies = {
    decode: vi.fn(async () => {
      if (options.decodeError) {
        throw options.decodeError;
      }
      return {
        source: { fixture: 'decoded-pixels' },
        width: options.width ?? 800,
        height: options.height ?? 600,
        dispose,
      };
    }),
    createCanvas: vi.fn((width, height) => ({
      width,
      height,
      draw,
      hasTransparency: () => options.transparent ?? false,
      encode,
    })),
    blobToDataUrl: vi.fn(async (blob) => (
      options.outputDataUrl ?? `data:${blob.type};base64,ZnJlc2g=`
    )),
  };

  return { dependencies, dispose, draw, encode };
}

describe('processImage', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp'])('accepts one %s input', async (mediaType) => {
    const { dependencies } = createDependencies();

    const result = await processImage(new Blob(['pixels'], { type: mediaType }), dependencies);

    expect(result).toMatchObject({ mediaType: 'image/jpeg', width: 800, height: 600 });
  });

  it.each(['', 'image/gif', 'image/svg+xml'])('rejects unsupported media type %j before decode', async (mediaType) => {
    const { dependencies } = createDependencies();

    await expect(processImage(new Blob(['pixels'], { type: mediaType }), dependencies))
      .rejects.toThrow('PNG, JPEG, or WebP');
    expect(dependencies.decode).not.toHaveBeenCalled();
  });

  it('accepts exactly 10 MB and rejects a larger input before decode', async () => {
    const accepted = createDependencies();
    const rejected = createDependencies();

    await expect(processImage(
      new Blob([new Uint8Array(MAX_IMAGE_BYTES)], { type: 'image/png' }),
      accepted.dependencies,
    )).resolves.toMatchObject({ width: 800, height: 600 });
    await expect(processImage(
      new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: 'image/png' }),
      rejected.dependencies,
    )).rejects.toThrow('10 MB');
    expect(rejected.dependencies.decode).not.toHaveBeenCalled();
  });

  it('rejects an image that cannot be decoded', async () => {
    const { dependencies } = createDependencies({ decodeError: new Error('codec detail') });

    await expect(processImage(new Blob(['broken'], { type: 'image/png' }), dependencies))
      .rejects.toThrow('Invalid image');
  });

  it.each([
    [0, 100],
    [100, 0],
    [Number.NaN, 100],
  ])('rejects invalid decoded dimensions %s × %s', async (width, height) => {
    const { dependencies } = createDependencies({ width, height });

    await expect(processImage(new Blob(['pixels'], { type: 'image/png' }), dependencies))
      .rejects.toThrow('Invalid image dimensions');
  });

  it('downscales the longest side to 2048 px while preserving proportions', async () => {
    const { dependencies, draw } = createDependencies({ width: 4096, height: 1536 });

    const result = await processImage(new Blob(['pixels'], { type: 'image/png' }), dependencies);

    expect(result).toMatchObject({ width: 2048, height: 768 });
    expect(dependencies.createCanvas).toHaveBeenCalledWith(2048, 768);
    expect(draw).toHaveBeenCalledWith({ fixture: 'decoded-pixels' }, 2048, 768);
  });

  it('keeps smaller image dimensions unchanged', async () => {
    const { dependencies } = createDependencies({ width: 1024, height: 2048 });

    const result = await processImage(new Blob(['pixels'], { type: 'image/webp' }), dependencies);

    expect(result).toMatchObject({ width: 1024, height: 2048 });
  });

  it('encodes transparent pixels as a fresh PNG and disposes the decoder', async () => {
    const { dependencies, dispose, encode } = createDependencies({
      transparent: true,
      outputDataUrl: 'data:image/png;base64,ZnJlc2gtcG5n',
    });

    const result = await processImage(
      new Blob(['source-metadata-and-pixels'], { type: 'image/webp' }),
      dependencies,
    );

    expect(result).toEqual({
      mediaType: 'image/png',
      dataUrl: 'data:image/png;base64,ZnJlc2gtcG5n',
      width: 800,
      height: 600,
    });
    expect(encode).toHaveBeenCalledWith('image/png', undefined);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('encodes opaque pixels as a fresh JPEG at quality 0.90', async () => {
    const { dependencies, encode } = createDependencies({
      transparent: false,
      outputDataUrl: 'data:image/jpeg;base64,ZnJlc2gtanBlZw==',
    });

    const result = await processImage(
      new Blob(['source-metadata-and-pixels'], { type: 'image/png' }),
      dependencies,
    );

    expect(result.dataUrl).toBe('data:image/jpeg;base64,ZnJlc2gtanBlZw==');
    expect(result.mediaType).toBe('image/jpeg');
    expect(encode).toHaveBeenCalledWith('image/jpeg', 0.90);
    expect(dependencies.blobToDataUrl).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image/jpeg' }),
    );
  });
});
