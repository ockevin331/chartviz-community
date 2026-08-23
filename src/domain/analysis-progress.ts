export type AnalysisProgressCode =
  | 'preparing'
  | 'reading_chart'
  | 'reviewing_clues'
  | 'checking_signals'
  | 'preparing_result';

export type AnalysisProgressEvent = {
  code: AnalysisProgressCode;
  createdAt: string;
};

const MESSAGES: Record<'en' | 'zh-CN', Record<AnalysisProgressCode, string>> = {
  en: {
    preparing: 'Preparing the analysis…',
    reading_chart: 'Reading the chart…',
    reviewing_clues: 'Some market clues are taking shape…',
    checking_signals: 'Checking key levels and trade conditions…',
    preparing_result: 'Preparing your analysis…',
  },
  'zh-CN': {
    preparing: '正在准备分析…',
    reading_chart: '正在解读图表…',
    reviewing_clues: '发现了一些值得关注的市场线索…',
    checking_signals: '正在核对关键位置和交易条件…',
    preparing_result: '正在整理分析结果…',
  },
};

export function visibleAnalysisProgress(
  events: AnalysisProgressEvent[],
  language: 'en' | 'zh-CN',
): Array<AnalysisProgressEvent & { message: string }> {
  const distinct = events.filter((event, index) => index === 0 || events[index - 1]?.code !== event.code);
  return distinct.slice(-3).map((event) => ({
    ...event,
    message: MESSAGES[language][event.code],
  }));
}
