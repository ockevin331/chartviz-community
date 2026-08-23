import { describe, expect, it } from 'vitest';
import { entryArrowGeometry } from './drawing-geometry';

describe('entryArrowGeometry', () => {
  it('keeps a long arrow compact and beneath its anchor', () => {
    const arrow = entryArrowGeometry(0.249875, 0.083, 0.396, 'long');

    expect(arrow.tipY).toBeGreaterThan(0.249875);
    expect(arrow.shaftY).toBeGreaterThan(arrow.tipY);
    expect(arrow.shaftY - arrow.tipY).toBeLessThanOrEqual(0.03);
    expect(arrow.shaftY).toBeLessThan(0.396);
  });

  it('keeps a short arrow above its anchor', () => {
    const arrow = entryArrowGeometry(0.315, 0.135, 0.812, 'short');

    expect(arrow.tipY).toBeLessThan(0.315);
    expect(arrow.shaftY).toBeLessThan(arrow.tipY);
    expect(arrow.shaftY).toBeGreaterThan(0.135);
  });

  it('clamps arrows that are close to a panel boundary', () => {
    const long = entryArrowGeometry(0.79, 0.1, 0.8, 'long');
    const short = entryArrowGeometry(0.11, 0.1, 0.8, 'short');

    expect(long.shaftY).toBeLessThanOrEqual(0.8);
    expect(short.shaftY).toBeGreaterThanOrEqual(0.1);
  });
});
