// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unavailableCloudGateway } from '../src/cloud/cloud-gateway';
import { AnalysisModeSettings } from '../src/ui/components/AnalysisModeSettings';

afterEach(cleanup);

function fixture(language: 'en' | 'zh-CN' = 'en') {
  const events: string[] = [];
  const props = {
    language,
    variant: 'setup' as const,
    activeMode: 'cloud' as const,
    selectedMode: 'cloud' as const,
    onSelectedModeChange: vi.fn(),
    initialDirectConfig: null,
    saveDirectConfig: vi.fn(async () => { events.push('config'); }),
    saveMode: vi.fn(async () => { events.push('mode'); }),
    onDirectActivated: vi.fn(() => { events.push('activate'); }),
    testConnection: vi.fn(async () => undefined),
    cloudGateway: unavailableCloudGateway,
  };
  return { props, events };
}

describe('AnalysisModeSettings', () => {
  it('shows truthful unavailable Cloud guidance without accepting credentials or screenshots', () => {
    const { props } = fixture();
    render(<AnalysisModeSettings {...props} />);

    expect(screen.getByRole('tab', { name: 'ChartViz Cloud' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Cloud connection will be enabled in a later update.')).toBeTruthy();
    expect(screen.getByText('Multi-timeframe analysis is provided through ChartViz Cloud.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Visit ChartViz' })).toHaveProperty(
      'href',
      'https://www.chartviz.xyz/',
    );
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /connect|save|continue/i })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('switches the pending tab without saving or activating a mode', async () => {
    const user = userEvent.setup();
    const { props } = fixture();
    render(<AnalysisModeSettings {...props} />);

    await user.click(screen.getByRole('tab', { name: 'Direct model' }));

    expect(props.onSelectedModeChange).toHaveBeenCalledWith('direct');
    expect(props.saveDirectConfig).not.toHaveBeenCalled();
    expect(props.saveMode).not.toHaveBeenCalled();
    expect(props.onDirectActivated).not.toHaveBeenCalled();
  });

  it('retains the complete Direct setup and activates only after config and mode persistence', async () => {
    const user = userEvent.setup();
    const { props, events } = fixture();
    render(<AnalysisModeSettings {...props} selectedMode="direct" />);

    expect(screen.getByRole('combobox', { name: 'Model' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeTruthy();
    await user.type(screen.getByLabelText('API key'), 'session-secret');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(props.onDirectActivated).toHaveBeenCalledTimes(1));
    expect(props.saveDirectConfig).toHaveBeenCalledWith({
      provider: 'openrouter',
      apiKey: 'session-secret',
      model: 'openai/gpt-5.6-terra',
      customModel: false,
    });
    expect(props.saveMode).toHaveBeenCalledWith('direct');
    expect(events).toEqual(['config', 'mode', 'activate']);
  });

  it('localizes the mode tabs and unavailable state in Simplified Chinese', () => {
    const { props } = fixture('zh-CN');
    render(<AnalysisModeSettings {...props} />);

    expect(screen.getByRole('tab', { name: '直连模型' })).toBeTruthy();
    expect(screen.getByText('托管式图表分析')).toBeTruthy();
    expect(screen.getByText('Cloud 连接将在后续版本开放。')).toBeTruthy();
    expect(screen.getByRole('link', { name: '访问 ChartViz' })).toBeTruthy();
  });

  it('uses a no-input unavailable Cloud gateway contract', () => {
    expect(unavailableCloudGateway.availability()).toEqual({
      available: false,
      code: 'cloud_not_available',
    });
    expect(Object.keys(unavailableCloudGateway)).toEqual(['availability', 'runtime']);
    expect(unavailableCloudGateway.runtime()).toBeNull();
    expect(unavailableCloudGateway.runtime.length).toBe(0);
  });
});
