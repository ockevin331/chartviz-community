// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisCapture } from '../src/analysis/runtime/analysis-runtime';
import { AnalysisCapturePreview } from '../src/ui/components/AnalysisCapturePreview';

afterEach(cleanup);

function capture(timeframe: string, suffix: string): AnalysisCapture {
  return {
    image: { dataUrl: `data:image/png;base64,${suffix}`, width: 1280, height: 720, mediaType: 'image/png' },
    context: { instrument: 'BTCUSDT', site: 'binance', timeframe },
  };
}

describe('AnalysisCapturePreview', () => {
  it('shows every multi-timeframe screenshot and its role while analysis is running', () => {
    render(<AnalysisCapturePreview
      language="en"
      captures={[capture('1d', 'MQ=='), capture('4h', 'Mg=='), capture('15m', 'Mw==')]}
      analyzing
      onZoom={vi.fn()}
    />);

    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getByText('Context · 1d')).toBeTruthy();
    expect(screen.getByText('Setup · 4h')).toBeTruthy();
    expect(screen.getByText('Trigger · 15m')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download image/ })).toBeNull();
  });

  it('keeps the single-chart preview compact without a role label', () => {
    render(<AnalysisCapturePreview
      language="en"
      captures={[capture('15m', 'MQ==')]}
      analyzing
      onZoom={vi.fn()}
    />);

    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.queryByText(/Context ·/)).toBeNull();
  });
});
