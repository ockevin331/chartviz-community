export type AnalysisMode = 'cloud' | 'direct';

export function isAnalysisMode(value: unknown): value is AnalysisMode {
  return value === 'cloud' || value === 'direct';
}
