// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisDiagnostic } from '../src/providers/provider-diagnostics';
import { AnalysisError } from '../src/ui/components/AnalysisError';
import { AnalysisProgress } from '../src/ui/components/AnalysisProgress';

afterEach(cleanup);

const diagnostic: AnalysisDiagnostic = {
  source: 'extension_local',
  pipelineVersion: 'community-3.0',
  requestId: 'cv_test_123',
  provider: 'openrouter',
  model: 'openai/gpt-5.6-terra',
  stage: 'report_semantics',
  occurredAt: '2026-08-26T12:00:00.000Z',
  durationMs: 1234,
  issues: [{ path: 'chart.timeframe', code: 'multiple_timeframes' }],
};

describe('AnalysisError diagnostics', () => {
  it.each([
    ['en', 'Multi-timeframe analysis is available through ChartViz Cloud.'],
    ['zh-CN', '多周期分析由 ChartViz Cloud 提供，直连模型暂不支持。'],
  ] as const)('localizes the Direct multi-timeframe boundary in %s', (language, message) => {
    render(<AnalysisError
      language={language}
      errorCode="multi_timeframe_requires_cloud"
      onBack={() => undefined}
    />);

    expect(screen.getByRole('alert')).toHaveProperty('textContent', message);
  });

  it('shows only concise public progress messages', () => {
    render(<AnalysisProgress
      language="en"
      progress={['preparing', 'reading_chart']}
      onCancel={() => undefined}
    />);

    expect(screen.getByText('Preparing the analysis…')).toBeTruthy();
    expect(screen.getByText('Reading the chart…')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/visual extraction|signal extraction|evidence reasoning|schema/i);
  });

  it('reveals and copies only the safe diagnostic payload on demand', async () => {
    const user = userEvent.setup();
    const copyText = vi.fn(async (_value: string) => undefined);
    render(<AnalysisError language="en" errorCode="invalid_response" diagnostic={diagnostic} onBack={() => undefined} copyText={copyText} />);

    expect(screen.queryByText('cv_test_123')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'View diagnostics' }));
    expect(screen.getByText('cv_test_123')).toBeTruthy();
    expect(screen.getByText('extension_local')).toBeTruthy();
    expect(screen.getByText('community-3.0')).toBeTruthy();
    expect(screen.getByText(/includes the prompts and structured model outputs/i)).toBeTruthy();
    expect(screen.getByText('chart.timeframe · multiple_timeframes')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    expect(copyText).toHaveBeenCalledTimes(1);
    const copied = copyText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain('report_semantics');
    expect(copied).toContain('"source": "extension_local"');
    expect(copied).toContain('"pipelineVersion": "community-3.0"');
    expect(copied).not.toMatch(/api.?key|data:image|system prompt/i);
  });
});
