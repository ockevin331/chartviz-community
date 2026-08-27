// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisDiagnostic } from '../src/providers/provider-diagnostics';
import { AnalysisError } from '../src/ui/components/AnalysisError';

afterEach(cleanup);

describe('analysis failure snapshot UI', () => {
  it('explains and copies the preserved prompts and outputs without image data or keys', async () => {
    const diagnostic: AnalysisDiagnostic = {
      source: 'extension_local', pipelineVersion: 'community-3.0', requestId: 'snapshot-id',
      provider: 'openrouter', model: 'openai/gpt-5.6-terra', stage: 'report_semantics',
      occurredAt: '2026-08-27T00:00:00.000Z', durationMs: 95_332,
      issues: [{
        path: 'tradePlan.summary', code: 'multiple_timeframes',
        valuePreview: 'The 1h chart confirms this 15m chart.',
      }],
      snapshot: {
        context: { instrument: 'BTC/USDT', timeframe: '15m', site: 'tradingview', exchange: 'BINANCE' },
        outputLanguage: 'en',
        stages: [{
          stage: 'evidence_reasoning', promptVersion: 'reasoning-1.0',
          schemaName: 'community_report_v3', hasImage: false,
          systemPrompt: 'system prompt', userPrompt: 'user prompt',
          output: { tradePlan: { summary: 'The 1h chart confirms this 15m chart.' } },
        }],
      },
    };
    const copyText = vi.fn(async (_value: string) => undefined);
    const user = userEvent.setup();
    render(<AnalysisError
      language="en"
      errorCode="invalid_response"
      diagnostic={diagnostic}
      onBack={() => undefined}
      copyText={copyText}
    />);

    await user.click(screen.getByRole('button', { name: 'View diagnostics' }));
    expect(screen.getByText(/includes the prompts and structured model outputs/i)).toBeTruthy();
    expect(screen.getByText(/tradePlan\.summary · multiple_timeframes/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    const copied = copyText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain('"systemPrompt": "system prompt"');
    expect(copied).toContain('The 1h chart confirms this 15m chart.');
    expect(copied).not.toMatch(/api.?key|data:image|bearer\s|sk-[A-Za-z0-9_-]{8,}/i);
  });
});
