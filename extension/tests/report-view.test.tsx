// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportView } from '../src/ui/components/ReportView';
import { annotatedImages, communityReport, processedImage } from './community-ui-fixtures';

afterEach(cleanup);

describe('ReportView community-3.0 visible structure', () => {
  it('renders a direct conclusion in cloud-aligned module order without a current-view wrapper', () => {
    const { container } = render(<ReportView language="en" report={communityReport} original={processedImage} annotations={annotatedImages} />);

    expect(Array.from(container.querySelectorAll('[data-report-section]')).map((node) => node.getAttribute('data-report-section'))).toEqual([
      'conclusion', 'marketExplanation', 'levels', 'tradePlan', 'tradeSignals', 'patterns', 'riskNotice',
    ]);
    expect(screen.getByRole('heading', { name: 'LONG' })).toBeTruthy();
    expect(screen.queryByText('Current view')).toBeNull();
    expect(container.querySelector('[data-report-section="conclusion"]')?.textContent).toContain('78%');
    expect(container.querySelector('[data-report-section="conclusion"]')?.textContent).toContain('Moderate');
    expect(container.querySelector('[data-report-section="conclusion"]')?.textContent).toContain('Higher highs and higher lows');
    expect(container.querySelector('[data-report-section="conclusion"]')?.textContent?.match(/LONG/g)).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Market explanation' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Support and resistance' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Trade plan' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Trade signals' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Chart patterns' })).toBeTruthy();
    expect(screen.queryByText('Limitations')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Evidence' })).toBeNull();
  });

  it('uses the same direct conclusion semantics in Chinese', () => {
    const { container } = render(<ReportView language="zh-CN" report={communityReport} original={processedImage} annotations={annotatedImages} />);

    expect(screen.getByRole('heading', { level: 2, name: '做多' })).toBeTruthy();
    expect(screen.queryByText('当前观点')).toBeNull();
    expect(container.querySelector('[data-report-section="conclusion"]')?.textContent).toContain('中等');
    expect(container.querySelector('[data-report-section="conclusion"]')?.textContent).toContain('高点和低点逐步抬高');
  });

  it('places the levels image under levels and each signal/pattern image under its own explanation', () => {
    const { container } = render(<ReportView language="en" report={communityReport} original={processedImage} annotations={annotatedImages} />);

    expect(container.querySelector('[data-report-section="levels"] img[src$="LEVELS"]')).toBeTruthy();
    expect(container.querySelector('[data-signal-id="S01"] img[src$="SIGNAL"]')).toBeTruthy();
    expect(container.querySelector('[data-pattern-id="P01"] img[src$="PATTERN"]')).toBeTruthy();
    expect(container.querySelector('[data-signal-id="S01"]')?.textContent).toContain('Breakout and retest');
    expect(container.querySelector('[data-pattern-id="P01"]')?.textContent).toContain('Close above the upper boundary.');
  });

  it('keeps every result image zoomable and downloadable', async () => {
    const user = userEvent.setup();
    const download = vi.fn();
    const postMessage = vi.spyOn(window.parent, 'postMessage');
    render(<ReportView language="en" report={communityReport} original={processedImage} annotations={annotatedImages} downloadImage={download} />);

    expect(screen.getAllByRole('button', { name: /Download image/ })).toHaveLength(4);
    for (const title of ['Original screenshot', 'Support and resistance', 'S01 · LONG', 'Rising channel']) {
      await user.click(screen.getByRole('button', { name: `Zoom: ${title}` }));
      expect(screen.getByRole('dialog', { name: title })).toBeTruthy();
      const close = screen.getByRole('button', { name: 'Close' });
      await waitFor(() => expect(document.activeElement).toBe(close));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    expect(postMessage).toHaveBeenCalledWith({ source: 'chartviz', type: 'image-lightbox-open' }, '*');
    expect(postMessage).toHaveBeenCalledWith({ source: 'chartviz', type: 'image-lightbox-close' }, '*');
  });

  it('copies the same V3-visible modules without wrapper or hidden schema fields', async () => {
    const copy = vi.fn(async (_text: string) => undefined);
    render(<ReportView language="en" report={communityReport} original={processedImage} annotations={annotatedImages} copyReport={copy} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy report' }));
    const copied = copy.mock.calls[0]?.[0] as string;

    for (const value of [
      'LONG', 'Higher lows remain visible.', 'Market explanation', 'Visible lows step upward.',
      'Price & volume', 'Technical indicators', 'Support and resistance', '63,900', 'Trade plan',
      'Trade signals', 'S01', 'Breakout and retest', 'Chart patterns', 'Rising channel', 'Risk notice',
    ]) expect(copied, value).toContain(value);
    expect(copied).not.toMatch(/Current view|schemaVersion|evidenceIds|xRatio|yRatio|Limitations/i);
  });
});
