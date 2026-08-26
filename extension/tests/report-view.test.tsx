// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('copies a readable report without exposing schema or hidden internals', async () => {
    const copy = vi.fn(async (_text: string) => undefined);
    render(<ReportView language="en" report={communityReport} original={processedImage} annotations={annotatedImages} copyReport={copy} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy report' }));
    expect(copy).toHaveBeenCalledTimes(1);
    const copied = copy.mock.calls[0]?.[0] as string;
    expect(copied).toContain('Higher lows remain visible.');
    expect(copied).toContain('Educational screenshot analysis only.');
    expect(copied).not.toMatch(/schemaVersion|payload|chain-of-thought/i);
  });
});
