// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportView } from '../src/ui/components/ReportView';
import { annotatedImages, communityReport, processedImage } from './community-ui-fixtures';

afterEach(cleanup);

describe('ReportView', () => {
  it('renders CommunityReport modules in schema order with complete long, short, and wait fields', () => {
    const { container } = render(<ReportView language="en" report={communityReport} original={processedImage} annotations={annotatedImages} />);
    expect(Array.from(container.querySelectorAll('[data-report-section]')).map((node) => node.getAttribute('data-report-section'))).toEqual([
      'chart', 'marketView', 'evidence', 'volume', 'indicators', 'levels', 'scenarios', 'patterns', 'signals', 'riskNotice',
    ]);
    for (const value of [
      'Close above resistance.', 'Enter after confirmation.', 'Below support.', 'Prior high', 'Upper boundary', 'Structure stays constructive.',
      'Close below support.', 'Above resistance.', 'Lower boundary', 'Support failure weakens structure.',
      'Remain inside the range.', 'No visible confirmation yet.',
    ]) expect(screen.getAllByText(value).length).toBeGreaterThan(0);
  });

  it('places the levels image under levels and each separated image inside its matching explanation', () => {
    const { container } = render(<ReportView language="en" report={communityReport} original={processedImage} annotations={annotatedImages} />);
    expect(container.querySelector('[data-report-section="levels"] img[src$="LEVELS"]')).toBeTruthy();
    expect(container.querySelector('[data-signal-id="breakout-long"] img[src$="SIGNAL"]')).toBeTruthy();
    expect(container.querySelector('[data-pattern-id="channel"] img[src$="PATTERN"]')).toBeTruthy();
  });

  it('renders readable evidence correlations for every report module and includes pattern bias', () => {
    const { container } = render(<ReportView language="en" report={communityReport} original={processedImage} annotations={annotatedImages} />);
    expect(container.querySelector('[data-report-section="evidence"] article')?.textContent).toContain('Evidence 1');
    for (const context of [
      'marketView', 'volume', 'indicator-RSI', 'level-support-main', 'scenario-long', 'scenario-short',
      'scenario-wait', 'pattern-channel', 'signal-breakout-long',
    ]) {
      const correlation = container.querySelector(`[data-evidence-context="${context}"]`);
      expect(correlation, context).toBeTruthy();
      expect(correlation?.querySelector('.evidence-chip')?.textContent, context).toBe('Evidence 1');
    }
    expect(container.querySelector('[data-pattern-id="channel"]')?.textContent).toContain('bullish');
    expect(container.querySelector('[data-pattern-id="channel"]')?.textContent).toContain('74%');
  });

  it('omits nullable or empty optional sections instead of showing placeholders', () => {
    const report = structuredClone(communityReport);
    report.volume = null; report.indicators = []; report.levels = []; report.patterns = []; report.signals = [];
    const { container } = render(<ReportView language="en" report={report} original={processedImage} annotations={{ levels: null, signals: {}, patterns: {} }} />);
    expect(Array.from(container.querySelectorAll('[data-report-section]')).map((node) => node.getAttribute('data-report-section'))).toEqual([
      'chart', 'marketView', 'evidence', 'scenarios', 'riskNotice',
    ]);
  });

  it('opens the original and every annotation in one lightbox and gives every image a download action', async () => {
    const user = userEvent.setup();
    const download = vi.fn();
    render(<ReportView language="en" report={communityReport} original={processedImage} annotations={annotatedImages} downloadImage={download} />);
    const zoomButtons = screen.getAllByRole('button', { name: /zoom/i });
    expect(zoomButtons).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /download/i })).toHaveLength(4);
    for (const button of zoomButtons) {
      await user.click(button);
      expect(screen.getByRole('dialog')).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
    }
  });

  it('focuses and traps the lightbox close control, then restores focus to its opener', async () => {
    const user = userEvent.setup();
    render(<ReportView language="en" report={communityReport} original={processedImage} annotations={annotatedImages} />);
    const opener = screen.getByRole('button', { name: 'Zoom: Original screenshot' });
    await user.click(opener);
    const close = screen.getByRole('button', { name: 'Close' });
    await waitFor(() => expect(document.activeElement).toBe(close));

    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(close);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('copies a readable report without exposing schema or hidden internals', async () => {
    const copy = vi.fn(async (_text: string) => undefined);
    render(<ReportView language="en" report={communityReport} original={processedImage} annotations={annotatedImages} copyReport={copy} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy report' }));
    expect(copy).toHaveBeenCalledTimes(1);
    const copied = copy.mock.calls[0]?.[0] as string;
    for (const value of [
      'Right edge partly obscured.', 'bullish', 'trend', 'moderate',
      'Evidence 1', 'price', 'Visible lows step upward.', 'Buyers defend higher prices.', 'Right half', '82%',
      'Volume expands on the latest upward candles.', 'RSI', 'RSI is above its midpoint.', 'Momentum leans upward.',
      'support', '63,900', 'Repeated reactions are visible.',
      'Close above resistance.', 'Enter after confirmation.', 'Below support.', 'Prior high', 'Upper boundary', 'Structure stays constructive.',
      'Close below support.', 'Above resistance.', 'Lower boundary', 'Support failure weakens structure.',
      'Remain inside the range.', 'No visible confirmation yet.',
      'Rising channel', 'forming', 'Left to right', 'Alternating pivots stay inside rising boundaries.', '74%',
      'breakout-long', 'long', 'Rightmost candle', 'Wait for a visible breakout close.', '65,350', '64,900', '65,850', '66,200', 'Approximately 1:2', '71%',
      'Educational screenshot analysis only.',
    ]) expect(copied, value).toContain(value);
    expect(copied).not.toMatch(/schemaVersion|payload|chain-of-thought|xRatio|yRatio/i);
  });
});
