// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderSetup } from '../src/ui/components/ProviderSetup';
import { ProviderError } from '../src/providers/provider-errors';

afterEach(cleanup);

describe('ProviderSetup', () => {
  it('selects a provider and curated model, masks the key, saves to session, and never navigates to a website', async () => {
    const user = userEvent.setup();
    const saveConfig = vi.fn(async () => undefined);
    const onConfigured = vi.fn();
    render(<ProviderSetup language="en" saveConfig={saveConfig} testConnection={async () => undefined} onConfigured={onConfigured} />);

    await user.selectOptions(screen.getByLabelText('Provider'), 'openai');
    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('gpt-5');
    await user.type(screen.getByLabelText('API key'), 'session-secret');
    expect(screen.getByLabelText('API key')).toHaveProperty('type', 'password');
    expect(screen.getByRole('button', { name: 'Show API key' }).querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show API key' }).textContent).toBe('');
    await user.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(screen.getByLabelText('API key')).toHaveProperty('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide API key' }).querySelector('svg')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith({ provider: 'openai', apiKey: 'session-secret', model: 'gpt-5', customModel: false }));
    expect(onConfigured).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('a[href]')).toHaveLength(0);
  });

  it('requires the visible multimodal acknowledgement for a custom model', async () => {
    const user = userEvent.setup();
    const saveConfig = vi.fn(async () => undefined);
    render(<ProviderSetup language="en" saveConfig={saveConfig} testConnection={async () => undefined} onConfigured={() => undefined} />);
    await user.type(screen.getByLabelText('API key'), 'key');
    await user.click(screen.getByLabelText('Use a custom model'));
    await user.type(screen.getByLabelText('Custom model ID'), 'vendor/vision-model');

    expect(screen.getByText(/must support image input/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toHaveProperty('disabled', true);
    await user.click(screen.getByLabelText(/I confirm this model supports image input/i));
    expect(screen.getByRole('button', { name: 'Save and continue' })).toHaveProperty('disabled', false);
  });

  it('shows the request-cost notice and localizes provider errors', async () => {
    const user = userEvent.setup();
    render(<ProviderSetup language="zh-CN" saveConfig={async () => undefined} testConnection={async () => { throw new ProviderError('invalid_api_key'); }} onConfigured={() => undefined} />);
    await user.type(screen.getByLabelText('API 密钥'), 'bad-key');
    expect(screen.getByText(/测试连接会向提供商发送请求并可能产生费用/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '测试连接' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('API 密钥无效'));
  });

  it('does not duplicate the header-owned language control', () => {
    render(<ProviderSetup language="en" saveConfig={async () => undefined} testConnection={async () => undefined} onConfigured={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Language' })).toBeNull();
  });
});
