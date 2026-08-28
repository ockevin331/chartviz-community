// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unavailableCloudGateway } from '../src/cloud/cloud-gateway';
import type { CloudConnectionState } from '../src/cloud/cloud-connection';
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
    activateDirect: vi.fn(async () => { events.push('activate'); return true; }),
    testConnection: vi.fn(async () => undefined),
    cloudConnection: { status: 'disconnected', account: null, errorCode: null } as CloudConnectionState,
    cloudBusy: false,
    onCloudConnect: vi.fn(async () => true),
    onCloudDisconnect: vi.fn(async () => undefined),
  };
  return { props, events };
}

describe('AnalysisModeSettings', () => {
  it('shows the fixed-service Cloud token form without accepting screenshots', () => {
    const { props } = fixture();
    render(<AnalysisModeSettings {...props} />);

    expect(screen.getByRole('tab', { name: 'ChartViz Cloud' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Cloud access token')).toHaveProperty('type', 'password');
    const apiUrl = screen.getByLabelText('Cloud API URL');
    expect(apiUrl).toHaveProperty('value', 'https://www.chartviz.xyz/api');
    expect(apiUrl).toHaveProperty('readOnly', true);
    expect(apiUrl).toHaveProperty('disabled', false);
    expect(screen.getByRole('link', { name: 'Create or revoke tokens on ChartViz' })).toHaveProperty(
      'href',
      'https://www.chartviz.xyz/settings',
    );
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect Cloud' })).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('submits the token once, clears the input, and never renders the plaintext', async () => {
    const user = userEvent.setup();
    const { props } = fixture();
    render(<AnalysisModeSettings {...props} />);

    const token = `cv_live_${'x'.repeat(43)}`;
    await user.type(screen.getByLabelText('Cloud access token'), token);
    await user.click(screen.getByRole('button', { name: 'Connect Cloud' }));

    await waitFor(() => expect(props.onCloudConnect).toHaveBeenCalledWith(token));
    expect(screen.getByLabelText('Cloud access token')).toHaveProperty('value', '');
    expect(document.body.textContent).not.toContain(token);
  });

  it('retains the token after a failed connection so the user can retry', async () => {
    const user = userEvent.setup();
    const { props } = fixture();
    props.onCloudConnect.mockResolvedValue(false);
    render(<AnalysisModeSettings {...props} />);

    const token = `cv_live_${'x'.repeat(43)}`;
    await user.type(screen.getByLabelText('Cloud access token'), token);
    await user.click(screen.getByRole('button', { name: 'Connect Cloud' }));

    await waitFor(() => expect(props.onCloudConnect).toHaveBeenCalledWith(token));
    expect(screen.getByLabelText('Cloud access token')).toHaveProperty('value', token);
  });

  it('shows live connected account context and disconnect guidance', async () => {
    const user = userEvent.setup();
    const { props } = fixture();
    render(<AnalysisModeSettings {...props} cloudConnection={{
      status: 'connected', errorCode: null,
      account: {
        emailMasked: 'k***n@example.com', plan: 'advance',
        currentPeriodEnd: '2026-09-28T00:00:00+00:00',
        quota: { limit: null, used: 7, remaining: null, unlimited: true },
        selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 2 },
        entitlements: { multiTimeframe: true, maxCaptures: 3 },
      },
    }} />);

    expect(screen.getByText('k***n@example.com')).toBeTruthy();
    expect(screen.getByText('ADVANCE')).toBeTruthy();
    expect(screen.getByText(/GPT-5.4/)).toBeTruthy();
    expect(screen.getByText(/Unlimited/)).toBeTruthy();
    expect(screen.queryByText('Cloud analysis activation follows in the next stage.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(props.onCloudDisconnect).toHaveBeenCalledTimes(1);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('localizes a precise expired-token connection error', () => {
    const { props } = fixture('zh-CN');
    render(<AnalysisModeSettings {...props} cloudConnection={{
      status: 'error', account: null, errorCode: 'token_expired',
    }} />);

    expect(screen.getByRole('alert').textContent).toContain('Cloud 访问令牌已过期');
  });

  it('switches the pending tab without saving or activating a mode', async () => {
    const user = userEvent.setup();
    const { props } = fixture();
    render(<AnalysisModeSettings {...props} />);

    await user.click(screen.getByRole('tab', { name: 'Direct model' }));

    expect(props.onSelectedModeChange).toHaveBeenCalledWith('direct');
    expect(props.activateDirect).not.toHaveBeenCalled();
  });

  it('retains the complete Direct setup and submits one typed activation request', async () => {
    const user = userEvent.setup();
    const { props, events } = fixture();
    render(<AnalysisModeSettings {...props} selectedMode="direct" />);

    expect(screen.getByRole('combobox', { name: 'Model' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeTruthy();
    await user.type(screen.getByLabelText('API key'), 'session-secret');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(props.activateDirect).toHaveBeenCalledTimes(1));
    expect(props.activateDirect).toHaveBeenCalledWith({
      provider: 'openrouter',
      apiKey: 'session-secret',
      model: 'openai/gpt-5.6-terra',
      customModel: false,
    });
    expect(events).toEqual(['activate']);
  });

  it('localizes the mode tabs and connection form in Simplified Chinese', () => {
    const { props } = fixture('zh-CN');
    render(<AnalysisModeSettings {...props} />);

    expect(screen.getByRole('tab', { name: '直连模型' })).toBeTruthy();
    expect(screen.getByText('托管式图表分析')).toBeTruthy();
    expect(screen.getByLabelText('Cloud 访问令牌')).toBeTruthy();
    expect(screen.getByRole('link', { name: '在 ChartViz 创建或撤销令牌' })).toBeTruthy();
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
