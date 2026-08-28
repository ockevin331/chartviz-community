// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisCapabilities } from '../src/analysis/runtime/analysis-runtime';
import {
  CaptureModeSelector,
  type CaptureMode,
} from '../src/ui/components/CaptureModeSelector';

afterEach(cleanup);

const directCapabilities: AnalysisCapabilities = {
  multiTimeframe: false,
  maxTimeframes: 1,
};
const cloudCapabilities: AnalysisCapabilities = {
  multiTimeframe: true,
  maxTimeframes: 3,
};

function SelectorHarness({
  capabilities,
  siteSupportsMultiTimeframe = true,
  language = 'en',
  onOpenCloudSettings = () => undefined,
}: {
  capabilities: AnalysisCapabilities;
  siteSupportsMultiTimeframe?: boolean;
  language?: 'en' | 'zh-CN';
  onOpenCloudSettings?(): void;
}) {
  const [mode, setMode] = useState<CaptureMode>('single');
  return <CaptureModeSelector
    language={language}
    mode={mode}
    capabilities={capabilities}
    siteSupportsMultiTimeframe={siteSupportsMultiTimeframe}
    onModeChange={setMode}
    onOpenCloudSettings={onOpenCloudSettings}
  />;
}

describe('CaptureModeSelector', () => {
  it('starts with single timeframe selected and presents role names without local timeframe defaults', () => {
    render(<SelectorHarness capabilities={directCapabilities} />);

    expect(screen.getByRole('group', { name: 'Screenshot mode' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Single timeframe/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Current chart')).toBeTruthy();
    expect(screen.getByText('Context')).toBeTruthy();
    expect(screen.getByText('Setup')).toBeTruthy();
    expect(screen.getByText('Trigger')).toBeTruthy();
    expect(screen.queryByText('4h')).toBeNull();
    expect(screen.queryByText('1h')).toBeNull();
    expect(screen.queryByText('15m')).toBeNull();
  });

  it('keeps Direct on single and opens localized Cloud guidance on request', async () => {
    const user = userEvent.setup();
    const openCloudSettings = vi.fn();
    render(<SelectorHarness
      capabilities={directCapabilities}
      language="zh-CN"
      onOpenCloudSettings={openCloudSettings}
    />);

    await user.click(screen.getByRole('button', { name: /多周期分析/ }));

    expect(screen.getByRole('button', { name: /单周期分析/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /多周期分析/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('status').textContent).toContain('多周期分析由 ChartViz Cloud 提供，直连模型暂不支持。');

    await user.click(screen.getByRole('button', { name: '查看 Cloud 设置' }));
    expect(openCloudSettings).toHaveBeenCalledTimes(1);
  });

  it('lets a capable Cloud runtime select multi-timeframe', async () => {
    const user = userEvent.setup();
    render(<SelectorHarness capabilities={cloudCapabilities} />);

    await user.click(screen.getByRole('button', { name: /Multi-timeframe/ }));

    expect(screen.getByRole('button', { name: /Multi-timeframe/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Single timeframe/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not select multi-timeframe on a site that disables switching', async () => {
    const user = userEvent.setup();
    render(<SelectorHarness
      capabilities={cloudCapabilities}
      siteSupportsMultiTimeframe={false}
    />);

    const multi = screen.getByRole('button', { name: /Multi-timeframe/ });
    expect(multi.getAttribute('aria-disabled')).toBe('true');
    await user.click(multi);

    expect(multi.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /Single timeframe/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Multi-timeframe capture is not supported on this site.');
  });
});
