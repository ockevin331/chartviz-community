export type {
  AnalysisWarning,
  AnalysisWarningStage,
} from '../analysis-quality-diagnostics';

export type OutputLanguage = 'en' | 'zh-CN';

export type StagePageContext = {
  instrument: string | null;
  timeframe: string | null;
  site: string | null;
  exchange: string | null;
};

export type StagePrompt = {
  version: string;
  system: string;
  user: string;
};

export function serializedPageContext(context: StagePageContext): string {
  return JSON.stringify({
    instrument: context.instrument?.replace(/\s+/g, ' ').trim() || null,
    timeframe: context.timeframe?.replace(/\s+/g, ' ').trim() || null,
    site: context.site?.replace(/\s+/g, ' ').trim() || null,
    exchange: context.exchange?.replace(/\s+/g, ' ').trim() || null,
  });
}
