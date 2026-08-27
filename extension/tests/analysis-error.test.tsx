// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisDiagnostic } from '../src/providers/provider-diagnostics';
import { AnalysisError } from '../src/ui/components/AnalysisError';
import { AnalysisProgress } from '../src/ui/components/AnalysisProgress';

afterEach(cleanup);

const diagnostic: AnalysisDiagnostic = {
  requestId: 'cv_test_123',
  provider: 'openrouter',
  model: 'openai/gpt-5.6-terra',
  stage: 'report_semantics',
  occurredAt: '2026-08-26T12:00:00.000Z',
  durationMs: 1234,
  issues: [{ path: 'chart.timeframe', code: 'multiple_timeframes' }],
};

describe('AnalysisError diagnostics', () => {
  it('shows only the three concise public progress messages', () => {
    render(<AnalysisProgress
      language="en"
      progress={['reading_chart', 'organizing_evidence']}
      onCancel={() => undefined}
    />);

    expect(screen.getByText('Reading chart')).toBeTruthy();
    expect(screen.getByText('Reviewing evidence')).toBeTruthy();
    expect(screen.getByText('Preparing result')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/visual extraction|signal extraction|evidence reasoning|schema/i);
  });

  it('reveals and copies only the safe diagnostic payload on demand', async () => {
    const user = userEvent.setup();
    const copyText = vi.fn(async (_value: string) => undefined);
    render(<AnalysisError language="en" errorCode="invalid_response" diagnostic={diagnostic} onBack={() => undefined} copyText={copyText} />);

    expect(screen.queryByText('cv_test_123')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'View diagnostics' }));
    expect(screen.getByText('cv_test_123')).toBeTruthy();
    expect(screen.getByText('chart.timeframe · multiple_timeframes')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    expect(copyText).toHaveBeenCalledTimes(1);
    const copied = copyText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain('report_semantics');
    expect(copied).not.toMatch(/api.?key|data:image|system prompt/i);
  });
});
