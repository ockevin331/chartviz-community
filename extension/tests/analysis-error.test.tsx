// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisDiagnostic } from '../src/providers/provider-diagnostics';
import { AnalysisError } from '../src/ui/components/AnalysisError';
import { AnalysisProgress } from '../src/ui/components/AnalysisProgress';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const diagnostic: AnalysisDiagnostic = {
  source: 'extension_local',
  pipelineVersion: 'community-3.0',
  requestId: 'cv_test_123',
  provider: 'openrouter',
  model: 'openai/gpt-5.6-terra',
  stage: 'report_semantics',
  occurredAt: '2026-08-26T12:00:00.000Z',
  durationMs: 1234,
  issues: [{ path: 'chart.timeframe', code: 'multiple_timeframes', valuePreview: '1h and 15m' }],
  snapshot: {
    context: { instrument: 'BTC/USDT', timeframe: '15m', site: 'tradingview', exchange: 'BINANCE' },
    outputLanguage: 'en',
    stages: [{
      stage: 'evidence_reasoning', promptVersion: 'reasoning-1.0', schemaName: 'community_report_v3',
      hasImage: false, systemPrompt: 'system prompt', userPrompt: 'user prompt',
      output: { tradePlan: { summary: 'The 1h chart confirms this 15m chart.' } },
    }],
  },
};

describe('AnalysisError diagnostics', () => {
  it.each([
    ['en', 'authentication_required', 'Connect ChartViz Cloud to continue.'],
    ['en', 'quota_exhausted', 'Your analysis quota is exhausted.'],
    ['en', 'invalid_chart_image', 'The screenshot is not a readable candlestick chart.'],
    ['en', 'incompatible_report_schema', 'Update ChartViz to read this Cloud report.'],
    ['zh-CN', 'authentication_required', '请先连接 ChartViz Cloud。'],
    ['zh-CN', 'quota_exhausted', '分析配额已用完。'],
    ['zh-CN', 'invalid_chart_image', '截图不是可识别的 K 线图。'],
    ['zh-CN', 'service_unavailable', 'ChartViz Cloud 暂时不可用。'],
  ] as const)('localizes Cloud error %s/%s', (language, errorCode, message) => {
    render(<AnalysisError language={language} errorCode={errorCode} onBack={() => undefined} />);
    expect(screen.getByRole('alert')).toHaveProperty('textContent', message);
  });

  it('renders an explicit pricing link without navigating automatically', () => {
    render(<AnalysisError
      language="en"
      errorCode="quota_exhausted"
      params={{ remaining: 0 }}
      pricingUrl="https://www.chartviz.xyz/#pricing"
      onBack={() => undefined}
    />);

    expect(screen.getByRole('link', { name: 'View plans' })).toHaveProperty(
      'href', 'https://www.chartviz.xyz/#pricing',
    );
  });

  it('does not render an untrusted pricing URL', () => {
    render(<AnalysisError
      language="en"
      errorCode="quota_exhausted"
      pricingUrl="https://example.com/phishing"
      onBack={() => undefined}
    />);

    expect(screen.queryByRole('link', { name: 'View plans' })).toBeNull();
  });
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
    expect(screen.getByText('openai/gpt-5.6-terra')).toBeTruthy();
    expect(screen.getByText('2026-08-26T12:00:00.000Z')).toBeTruthy();
    expect(screen.getByText(/includes the prompts and structured model outputs/i)).toBeTruthy();
    expect(screen.getByText('chart.timeframe · multiple_timeframes · “1h and 15m”')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    expect(copyText).toHaveBeenCalledTimes(1);
    const copied = copyText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain('report_semantics');
    expect(copied).toContain('"source": "extension_local"');
    expect(copied).toContain('"pipelineVersion": "community-3.0"');
    expect(copied).toContain('"valuePreview": "1h and 15m"');
    expect(copied).toContain('"systemPrompt": "system prompt"');
    expect(copied).toContain('The 1h chart confirms this 15m chart.');
    expect(copied).not.toMatch(/api.?key|data:image|bearer\s|sk-[A-Za-z0-9_-]{8,}/i);
    expect(screen.getByText('Complete diagnostic JSON')).toBeTruthy();
    expect(screen.getByText(/"systemPrompt": "system prompt"/)).toBeTruthy();
  });

  it('shows a green copy-success message and removes it after three seconds', async () => {
    vi.useFakeTimers();
    const copyText = vi.fn(async () => undefined);
    render(<AnalysisError language="en" errorCode="invalid_response" diagnostic={diagnostic} onBack={() => undefined} copyText={copyText} />);
    fireEvent.click(screen.getByRole('button', { name: 'View diagnostics' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
      await Promise.resolve();
    });

    const success = screen.getByRole('status');
    expect(success).toHaveProperty('textContent', expect.stringContaining('Copied successfully'));
    expect(success.classList.contains('success')).toBe(true);
    act(() => vi.advanceTimersByTime(2_999));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Copied successfully')).toBeNull();
  });

  it('shows an explicit error when the clipboard write is rejected', async () => {
    const copyText = vi.fn(async () => { throw new Error('clipboard blocked'); });
    render(<AnalysisError language="en" errorCode="invalid_response" diagnostic={diagnostic} onBack={() => undefined} copyText={copyText} />);
    fireEvent.click(screen.getByRole('button', { name: 'View diagnostics' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
      await Promise.resolve();
    });

    expect(screen.getByText('Copy failed. Please download the diagnostic JSON instead.')).toBeTruthy();
  });

  it('downloads the complete diagnostic JSON when clipboard access is unavailable', async () => {
    const downloadText = vi.fn((_name: string, _value: string) => undefined);
    render(<AnalysisError
      language="en"
      errorCode="invalid_response"
      diagnostic={diagnostic}
      onBack={() => undefined}
      downloadText={downloadText}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'View diagnostics' }));

    fireEvent.click(screen.getByRole('button', { name: 'Download diagnostic JSON' }));

    expect(downloadText).toHaveBeenCalledTimes(1);
    expect(downloadText.mock.calls[0]?.[0]).toBe('chartviz-diagnostic-cv_test_123.json');
    expect(downloadText.mock.calls[0]?.[1]).toContain('"requestId": "cv_test_123"');
  });

  it('shows the upstream HTTP status when it exists', () => {
    render(<AnalysisError
      language="en"
      errorCode="invalid_response"
      diagnostic={{ ...diagnostic, httpStatus: 502 }}
      onBack={() => undefined}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'View diagnostics' }));

    expect(screen.getByText('HTTP status')).toBeTruthy();
    expect(screen.getByText('502')).toBeTruthy();
  });
});
