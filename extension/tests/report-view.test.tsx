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

afterEach(cleanup);

const directPresentation = parseReportPresentationModel(structuredClone(validPresentationBundle.report));
const cloudTask = parseExtensionAnalysisTask(structuredClone(fixture));
if (!cloudTask.report) throw new Error('Cloud fixture report missing');
const cloudPresentation = adaptCloudPresentation(cloudTask.report).report;

describe('ReportView presentation-1.0 visible structure', () => {
  it.each([
    ['Direct', directPresentation],
    ['Cloud', cloudPresentation],
  ] as const)('renders the %s conclusion in the same module order and terminology', (_producer, presentation) => {
    const { container } = render(<ReportView language="en" presentation={presentation} original={processedImage} annotations={presentationAnnotatedImages} />);

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
    const { container } = render(<ReportView language="zh-CN" presentation={directPresentation} original={processedImage} annotations={presentationAnnotatedImages} />);

    expect(screen.getByRole('heading', { level: 2, name: '做多' })).toBeTruthy();
    expect(screen.queryByText('当前观点')).toBeNull();
    expect(container.querySelector('[data-report-section="conclusion"]')?.textContent).toContain('中等');
    expect(container.querySelector('[data-report-section="conclusion"]')?.textContent).toContain('高点和低点逐步抬高');
  });

  it('places the levels image under levels and each signal/pattern image under its own explanation', () => {
    const { container } = render(<ReportView language="en" presentation={directPresentation} original={processedImage} annotations={presentationAnnotatedImages} />);

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
    render(<ReportView language="en" presentation={directPresentation} original={processedImage} annotations={presentationAnnotatedImages} downloadImage={download} />);

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

  it('opens each capture-specific result image with its exact source data URL', async () => {
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
    const original = { ...processedImage, dataUrl: 'data:image/png;base64,C01SOURCE' };
    const annotations = {
      levels: {
        C01: { ...presentationAnnotatedImages.levels.C01!, dataUrl: 'data:image/png;base64,C01LEVELS' },
      },
      signals: {
        S01: { ...presentationAnnotatedImages.signals.S01!, dataUrl: 'data:image/png;base64,C03SIGNAL' },
      },
      patterns: {
        P01: { ...presentationAnnotatedImages.patterns.P01!, dataUrl: 'data:image/png;base64,C02PATTERN' },
      },
    };
    render(<ReportView language="en" presentation={presentation} original={original} annotations={annotations} />);

    for (const [title, dataUrl] of [
      ['Original screenshot', original.dataUrl],
      ['Support and resistance', annotations.levels.C01.dataUrl],
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
    render(<ReportView language="en" presentation={directPresentation} original={processedImage} annotations={presentationAnnotatedImages} copyReport={copy} />);
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
