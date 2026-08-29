// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../contracts/extension-cloud/v1/fixtures/single-completed-task.json';
import { parseExtensionAnalysisTask } from '../src/cloud/cloud-task-schema';
import { adaptCloudPresentation } from '../src/presentation/cloud-presentation-adapter';
import { parseReportPresentationModel } from '../src/presentation/report-presentation-model';
import { ReportView } from '../src/ui/components/ReportView';
import { presentationAnnotatedImages, processedImage } from './community-ui-fixtures';
import { validPresentationBundle } from './presentation-fixtures';
import type { AnalysisCapture } from '../src/analysis/runtime/analysis-runtime';

afterEach(cleanup);

const directPresentation = parseReportPresentationModel(structuredClone(validPresentationBundle.report));
const cloudTask = parseExtensionAnalysisTask(structuredClone(fixture));
if (!cloudTask.report) throw new Error('Cloud fixture report missing');
const cloudPresentation = adaptCloudPresentation(cloudTask.report).report;

function sourceCapture(
  image = processedImage,
  timeframe = '15m',
): AnalysisCapture {
  return {
    image,
    context: { instrument: 'BTC/USDT', timeframe },
  };
}

describe('ReportView presentation-1.0 visible structure', () => {
  it.each([
    ['Direct', directPresentation],
    ['Cloud', cloudPresentation],
  ] as const)('renders the %s conclusion in the same module order and terminology', (_producer, presentation) => {
    const { container } = render(<ReportView language="en" presentation={presentation} captures={[sourceCapture()]} annotations={presentationAnnotatedImages} />);

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
    const { container } = render(<ReportView language="zh-CN" presentation={directPresentation} captures={[sourceCapture()]} annotations={presentationAnnotatedImages} />);

    expect(screen.getByRole('heading', { level: 2, name: '做多' })).toBeTruthy();
    expect(screen.queryByText('当前观点')).toBeNull();
    expect(container.querySelector('[data-report-section="conclusion"]')?.textContent).toContain('中等');
    expect(container.querySelector('[data-report-section="conclusion"]')?.textContent).toContain('高点和低点逐步抬高');
  });

  it('places the levels image under levels and each signal/pattern image under its own explanation', () => {
    const { container } = render(<ReportView language="en" presentation={directPresentation} captures={[sourceCapture()]} annotations={presentationAnnotatedImages} />);

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
    render(<ReportView language="en" presentation={directPresentation} captures={[sourceCapture()]} annotations={presentationAnnotatedImages} downloadImage={download} />);

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

  it('renders restored originals, levels, signals, and patterns with exact inline and lightbox sources', async () => {
    const user = userEvent.setup();
    const presentation = parseReportPresentationModel({
      ...structuredClone(validPresentationBundle.report),
      context: {
        ...structuredClone(validPresentationBundle.report.context),
        captures: [
          { ...validPresentationBundle.report.context.captures[0], captureId: 'C01', timeframe: '4h', role: 'context' },
          { ...validPresentationBundle.report.context.captures[0], captureId: 'C02', timeframe: '1h', role: 'setup' },
          { ...validPresentationBundle.report.context.captures[0], captureId: 'C03', timeframe: '15m', role: 'trigger' },
        ],
      },
      levels: [
        { ...validPresentationBundle.report.levels[0], id: 'L01', captureId: 'C01' },
        { ...validPresentationBundle.report.levels[0], id: 'L02', captureId: 'C02' },
        { ...validPresentationBundle.report.levels[0], id: 'L03', captureId: 'C03' },
      ],
      tradeSignals: validPresentationBundle.report.tradeSignals.map((signal) => ({
        ...signal, captureId: 'C03',
      })),
      patterns: validPresentationBundle.report.patterns.map((pattern) => ({
        ...pattern, captureId: 'C02',
      })),
      timeframeViews: [
        { ...validPresentationBundle.report.timeframeViews[0], captureId: 'C01', timeframe: '4h', role: 'context' },
        { ...validPresentationBundle.report.timeframeViews[0], captureId: 'C02', timeframe: '1h', role: 'setup' },
        { ...validPresentationBundle.report.timeframeViews[0], captureId: 'C03', timeframe: '15m', role: 'trigger' },
      ],
    });
    const captures = [
      sourceCapture({ ...processedImage, dataUrl: 'data:image/png;base64,C01SOURCE' }, '4h'),
      sourceCapture({ ...processedImage, dataUrl: 'data:image/png;base64,C02SOURCE' }, '1h'),
      sourceCapture({ ...processedImage, dataUrl: 'data:image/png;base64,C03SOURCE' }, '15m'),
    ];
    const annotations = {
      levels: {
        C01: { ...presentationAnnotatedImages.levels.C01!, dataUrl: 'data:image/png;base64,C01LEVELS' },
        C02: { ...presentationAnnotatedImages.levels.C01!, id: 'levels-C02', dataUrl: 'data:image/png;base64,C02LEVELS' },
        C03: { ...presentationAnnotatedImages.levels.C01!, id: 'levels-C03', dataUrl: 'data:image/png;base64,C03LEVELS' },
      },
      signals: {
        S01: { ...presentationAnnotatedImages.signals.S01!, dataUrl: 'data:image/png;base64,C03SIGNAL' },
      },
      patterns: {
        P01: { ...presentationAnnotatedImages.patterns.P01!, dataUrl: 'data:image/png;base64,C02PATTERN' },
      },
    };
    const { container } = render(<ReportView language="en" presentation={presentation} captures={captures} annotations={annotations} />);

    const originalGrid = container.querySelector('.original-capture-grid');
    expect(originalGrid?.classList.contains('multi')).toBe(true);
    expect(originalGrid?.querySelectorAll(':scope > [data-original-capture-id]')).toHaveLength(3);
    expect(Array.from(container.querySelectorAll('[data-original-capture-id]')).map((node) => (
      node.getAttribute('data-original-capture-id')
    ))).toEqual(['C01', 'C02', 'C03']);
    expect(Array.from(container.querySelectorAll('[data-levels-capture-id]')).map((node) => (
      node.getAttribute('data-levels-capture-id')
    ))).toEqual(['C01', 'C02', 'C03']);
    expect(Array.from(container.querySelectorAll('[data-original-capture-id] img')).map((node) => (
      node.getAttribute('src')
    ))).toEqual(captures.map(({ image }) => image.dataUrl));
    expect(Array.from(container.querySelectorAll('[data-levels-capture-id] img')).map((node) => (
      node.getAttribute('src')
    ))).toEqual([
      annotations.levels.C01.dataUrl,
      annotations.levels.C02.dataUrl,
      annotations.levels.C03.dataUrl,
    ]);
    expect(container.querySelector('[data-signal-id="S01"] img')?.getAttribute('src'))
      .toBe(annotations.signals.S01.dataUrl);
    expect(container.querySelector('[data-pattern-id="P01"] img')?.getAttribute('src'))
      .toBe(annotations.patterns.P01.dataUrl);

    for (const [title, dataUrl] of [
      ['Original screenshot · 4h', captures[0]!.image.dataUrl],
      ['Original screenshot · 1h', captures[1]!.image.dataUrl],
      ['Original screenshot · 15m', captures[2]!.image.dataUrl],
      ['Support and resistance · 4h', annotations.levels.C01.dataUrl],
      ['Support and resistance · 1h', annotations.levels.C02.dataUrl],
      ['Support and resistance · 15m', annotations.levels.C03.dataUrl],
      ['S01 · LONG', annotations.signals.S01.dataUrl],
      ['Rising channel', annotations.patterns.P01.dataUrl],
    ] as const) {
      await user.click(screen.getByRole('button', { name: `Zoom: ${title}` }));
      const dialog = screen.getByRole('dialog', { name: title });
      expect(within(dialog).getByRole('img').getAttribute('src')).toBe(dataUrl);
      await user.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it('copies the same V3-visible modules without wrapper or hidden schema fields', async () => {
    const copy = vi.fn(async (_text: string) => undefined);
    render(<ReportView language="en" presentation={directPresentation} captures={[sourceCapture()]} annotations={presentationAnnotatedImages} copyReport={copy} />);
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
