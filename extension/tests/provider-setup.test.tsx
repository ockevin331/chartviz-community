// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderSetup } from '../src/ui/components/ProviderSetup';
import { ProviderError } from '../src/providers/provider-errors';
import type { ProviderConfig } from '../src/providers/provider-types';

afterEach(cleanup);

describe('ProviderSetup', () => {
  it('presents key and screenshot handling as a prominent non-interactive privacy notice', () => {
    render(<ProviderSetup language="en" saveConfig={async () => true} testConnection={async () => undefined} onConfigured={() => undefined} />);

    const notice = screen.getByRole('note', { name: 'Privacy & data' });
    expect(within(notice).getByText(/key stays in extension session storage/i)).toBeTruthy();
    expect(within(notice).getByText(/screenshots go directly to the selected service/i)).toBeTruthy();
    expect(notice.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(within(notice).queryByRole('checkbox')).toBeNull();
    expect(within(notice).queryByRole('button')).toBeNull();
  });

  it('explains the three-request analysis boundary, defaults to the recommended OpenRouter model, and never exposes Provider', async () => {
    const user = userEvent.setup();
    const saveConfig = vi.fn(async () => true);
    const testConnection = vi.fn(async () => undefined);
    const onConfigured = vi.fn();
    render(<ProviderSetup language="en" saveConfig={saveConfig} testConnection={testConnection} onConfigured={onConfigured} />);

    expect(document.querySelector('select')).toBeNull();
    expect(screen.getByText(/select a vision-capable model/i)).toBeTruthy();
    expect(screen.getByText(/sends the captured chart directly/i)).toBeTruthy();
    expect(screen.getByText(/each analysis uses three provider requests/i)).toBeTruthy();
    expect(screen.getByText(/failed requests are not retried automatically/i)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Provider' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveProperty('textContent', expect.stringContaining('openai/gpt-5.6-terra'));
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toHaveProperty('checked', true);
    expect(screen.queryByText(/I confirm this model supports image input/i)).toBeNull();
    await user.type(screen.getByLabelText('API key'), 'session-secret');
    expect(screen.getByLabelText('API key')).toHaveProperty('type', 'password');
    expect(screen.getByRole('button', { name: 'Show API key' }).querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show API key' }).textContent).toBe('');
    await user.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(screen.getByLabelText('API key')).toHaveProperty('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide API key' }).querySelector('svg')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith({ provider: 'openrouter', apiKey: 'session-secret', model: 'openai/gpt-5.6-terra', customModel: false }));
    expect(onConfigured).toHaveBeenCalledTimes(1);
    expect(testConnection).not.toHaveBeenCalled();
    expect(document.querySelectorAll('a[href]')).toHaveLength(0);
  });

  it('does not notify configuration when the owning save transition was invalidated', async () => {
    const user = userEvent.setup();
    const saveConfig = vi.fn(async () => false);
    const onConfigured = vi.fn();
    render(<ProviderSetup language="en" saveConfig={saveConfig} testConnection={async () => undefined} onConfigured={onConfigured} />);

    await user.type(screen.getByLabelText('API key'), 'session-secret');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1));
    expect(onConfigured).not.toHaveBeenCalled();
  });

  it('routes OpenAI and Google models directly when OpenRouter is disabled', async () => {
    const user = userEvent.setup();
    const saveConfig = vi.fn(async () => true);
    render(<ProviderSetup language="en" saveConfig={saveConfig} testConnection={async () => undefined} onConfigured={() => undefined} />);
    await user.type(screen.getByLabelText('API key'), 'key');
    await user.click(screen.getByRole('checkbox', { name: 'Use OpenRouter' }));
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(saveConfig).toHaveBeenLastCalledWith({
      provider: 'openai', apiKey: 'key', model: 'gpt-5.6-terra', customModel: false,
    }));

    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(screen.getByRole('option', { name: /google\/gemini-3\.7-flash/i }));
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(saveConfig).toHaveBeenLastCalledWith({
      provider: 'gemini', apiKey: 'key', model: 'gemini-3.7-flash', customModel: false,
    }));
  });

  it('groups every approved model by vendor and keeps Anthropic and Qwen on OpenRouter', async () => {
    const user = userEvent.setup();
    render(<ProviderSetup language="en" saveConfig={async () => true} testConnection={async () => undefined} onConfigured={() => undefined} />);

    await user.click(screen.getByRole('combobox', { name: 'Model' }));

    for (const modelId of [
      'openai/gpt-5.6-terra',
      'openai/gpt-5.6-sol',
      'openai/gpt-5.6-luna',
      'google/gemini-3.7-flash',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-opus-5',
      'anthropic/claude-haiku-4.5',
      'qwen/qwen3.7-plus',
      'qwen/qwen3-vl-235b-a22b-instruct',
      'qwen/qwen3-vl-8b-instruct',
    ]) expect(screen.getByRole('option', { name: new RegExp(modelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeTruthy();
    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('Anthropic')).toBeTruthy();
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.getByText('Qwen')).toBeTruthy();
    expect(screen.queryByRole('option', { name: /gemini-3\.1-pro-preview/ })).toBeNull();

    await user.click(screen.getByRole('option', { name: /anthropic\/claude-sonnet-5/i }));
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toHaveProperty('checked', true);
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/required for this model/i)).toBeTruthy();
  });

  it('accepts a custom OpenRouter model without a confirmation checkbox', async () => {
    const user = userEvent.setup();
    const saveConfig = vi.fn(async () => true);
    render(<ProviderSetup language="en" saveConfig={saveConfig} testConnection={async () => undefined} onConfigured={() => undefined} />);
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(screen.getByRole('option', { name: /custom model/i }));
    await user.type(screen.getByLabelText('Custom model ID'), 'vendor/vision-model');
    await user.type(screen.getByLabelText('API key'), 'key');

    expect(screen.getByText(/must support image input/i)).toBeTruthy();
    expect(screen.queryByText(/I confirm this model supports image input/i)).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toHaveProperty('checked', true);
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Save and continue' })).toHaveProperty('disabled', false);

    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith({
      provider: 'openrouter', apiKey: 'key', model: 'vendor/vision-model', customModel: true,
    }));
  });

  it.each([
    [
      'direct OpenAI',
      { provider: 'openai', apiKey: 'openai-key', model: 'gpt-5.6-sol', customModel: false },
      'openai/gpt-5.6-sol',
      false,
    ],
    [
      'direct Gemini',
      { provider: 'gemini', apiKey: 'google-key', model: 'gemini-3.7-flash', customModel: false },
      'google/gemini-3.7-flash',
      false,
    ],
    [
      'OpenRouter',
      { provider: 'openrouter', apiKey: 'router-key', model: 'qwen/qwen3.7-plus', customModel: false },
      'qwen/qwen3.7-plus',
      true,
    ],
  ] as const)('restores an existing %s configuration', (_name, initialConfig, modelLabel, openRouter) => {
    render(<ProviderSetup language="en" initialConfig={initialConfig as ProviderConfig} saveConfig={async () => true} testConnection={async () => undefined} onConfigured={() => undefined} />);
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveProperty('textContent', expect.stringContaining(modelLabel));
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toHaveProperty('checked', openRouter);
  });

  it('restores an existing custom OpenRouter configuration', () => {
    const initialConfig: ProviderConfig = {
      provider: 'openrouter', apiKey: 'router-key', model: 'vendor/custom-vision', customModel: true,
    };
    render(<ProviderSetup language="en" initialConfig={initialConfig} saveConfig={async () => true} testConnection={async () => undefined} onConfigured={() => undefined} />);
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveProperty('textContent', expect.stringContaining('Custom model'));
    expect(screen.getByLabelText('Custom model ID')).toHaveProperty('value', 'vendor/custom-vision');
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toHaveProperty('checked', true);
  });

  it('sends exactly one request when testing the connection and localizes provider errors', async () => {
    const user = userEvent.setup();
    const testConnection = vi.fn(async () => { throw new ProviderError('invalid_api_key'); });
    render(<ProviderSetup language="zh-CN" saveConfig={async () => true} testConnection={testConnection} onConfigured={() => undefined} />);
    await user.type(screen.getByLabelText('API 密钥'), 'bad-key');
    expect(screen.getByText(/测试连接会向提供商发送 1 次请求/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '测试连接' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('API 密钥无效'));
    expect(testConnection).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate the header-owned language control', () => {
    render(<ProviderSetup language="en" saveConfig={async () => true} testConnection={async () => undefined} onConfigured={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Language' })).toBeNull();
  });
});
