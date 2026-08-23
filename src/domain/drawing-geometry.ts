export type EntryArrowDirection = 'long' | 'short';

export type EntryArrowGeometry = {
  tipY: number;
  shaftY: number;
  stemEndY: number;
  wingY: number;
  halfWidthRatio: number;
  labelY: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Positions a compact entry arrow just outside its price/candle anchor.
 * All values stay normalized to the full source image so SVG previews and
 * downloaded canvases use identical geometry.
 */
export function entryArrowGeometry(
  anchorY: number,
  topBound: number,
  bottomBound: number,
  direction: EntryArrowDirection,
): EntryArrowGeometry {
  const top = clamp(topBound, 0, 1);
  const bottom = clamp(bottomBound, top + 0.01, 1);
  const panelHeight = Math.max(0.05, bottom - top);
  const gap = clamp(panelHeight * 0.035, 0.007, 0.014);
  const shaftLength = clamp(panelHeight * 0.08, 0.018, 0.03);
  const headDepth = clamp(panelHeight * 0.027, 0.006, 0.01);
  const halfWidthRatio = clamp(panelHeight * 0.018, 0.004, 0.006);
  const sign = direction === 'long' ? 1 : -1;
  const minimumTip = top + (direction === 'short' ? shaftLength : 0.004);
  const maximumTip = bottom - (direction === 'long' ? shaftLength : 0.004);
  const tipY = clamp(anchorY + sign * gap, minimumTip, maximumTip);
  const shaftY = tipY + sign * shaftLength;
  const wingY = tipY + sign * headDepth;
  const stemEndY = tipY + sign * headDepth * 0.55;
  const labelY = direction === 'long'
    ? Math.min(bottom - 0.004, tipY + headDepth + 0.014)
    : Math.max(top + 0.018, tipY - headDepth - 0.006);
  return { tipY, shaftY, stemEndY, wingY, halfWidthRatio, labelY };
}
