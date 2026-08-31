// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderSetup } from '../src/ui/components/ProviderSetup';
import { ProviderError } from '../src/providers/provider-errors';
import { attachProviderFailureDetail } from '../src/providers/provider-diagnostics';
import type { ProviderConfig } from '../src/providers/provider-types';
import { SettingsSaveError } from '../src/storage/settings-save-error';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('ProviderSetup', () => {
  it('presents key and screenshot handling as a prominent non-interactive privacy notice', () => {
    render(<ProviderSetup language="en" saveConfig={async () => undefined} testConnection={async () => undefined} onConfigured={() => undefined} />);

    const notice = screen.getByRole('note', { name: 'Privacy & data' });
    expect(within(notice).getByText(/key stays in extension session storage/i)).toBeTruthy();
    expect(within(notice).getByText(/screenshots go directly to the selected service/i)).toBeTruthy();
    expect(notice.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(within(notice).queryByRole('checkbox')).toBeNull();
    expect(within(notice).queryByRole('button')).toBeNull();
  });

  it('explains the three-request analysis boundary, defaults to the recommended OpenRouter model, and never exposes Provider', async () => {
    const user = userEvent.setup();
    const saveConfig = vi.fn(async () => undefined);
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
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith({ provider: 'openrouter', apiKey: 'session-secret', model: 'openai/gpt-5.6-terra', customModel: false }));
    expect(onConfigured).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveProperty('textContent', 'Settings saved.');
    expect(testConnection).not.toHaveBeenCalled();
    expect(document.querySelectorAll('a[href]')).toHaveLength(0);
  });

  it('shows an explicit error when the owning save transition was invalidated', async () => {
    const user = userEvent.setup();
    const saveConfig = vi.fn(async () => { throw new SettingsSaveError('mode_transition_superseded'); });
    const onConfigured = vi.fn();
    render(<ProviderSetup language="en" saveConfig={saveConfig} testConnection={async () => undefined} onConfigured={onConfigured} />);

    await user.type(screen.getByLabelText('API key'), 'session-secret');
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1));
    expect(onConfigured).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('Settings were not saved'),
    );
  });

  it('disables Save while a Direct configuration submission is pending', async () => {
    const user = userEvent.setup();
    const submission = deferred<void>();
    const saveConfig = vi.fn(() => submission.promise);
    render(<ProviderSetup language="en" saveConfig={saveConfig} testConnection={async () => undefined} />);

    await user.type(screen.getByLabelText('API key'), 'session-secret');
    const save = screen.getByRole('button', { name: 'Save and set as default' });
    await user.click(save);

    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1));
    expect(save).toHaveProperty('disabled', true);
    expect(save).toHaveProperty('textContent', 'Saving…');

    await act(async () => {
      submission.resolve();
      await submission.promise;
    });
    await waitFor(() => expect(save).toHaveProperty('disabled', false));
  });

  it('routes approved OpenAI models directly when OpenRouter is disabled', async () => {
    const user = userEvent.setup();
    const saveConfig = vi.fn(async () => undefined);
    render(<ProviderSetup language="en" saveConfig={saveConfig} testConnection={async () => undefined} onConfigured={() => undefined} />);
    await user.type(screen.getByLabelText('API key'), 'key');
    await user.click(screen.getByRole('checkbox', { name: 'Use OpenRouter' }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));
    await waitFor(() => expect(saveConfig).toHaveBeenLastCalledWith({
      provider: 'openai', apiKey: 'key', model: 'gpt-5.6-terra', customModel: false,
    }));
  });

  it('groups every approved model by vendor and keeps Anthropic and Qwen on OpenRouter', async () => {
    const user = userEvent.setup();
    render(<ProviderSetup language="en" saveConfig={async () => undefined} testConnection={async () => undefined} onConfigured={() => undefined} />);

    await user.click(screen.getByRole('combobox', { name: 'Model' }));

    for (const modelId of [
      'openai/gpt-5.6-terra',
      'openai/gpt-5.6-sol',
      'openai/gpt-5.6-luna',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-opus-5',
      'anthropic/claude-haiku-4.5',
      'qwen/qwen3.7-plus',
      'qwen/qwen3-vl-235b-a22b-instruct',
      'qwen/qwen3-vl-8b-instruct',
    ]) expect(screen.getByRole('option', { name: new RegExp(modelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeTruthy();
    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('Anthropic')).toBeTruthy();
    expect(screen.queryByText('Google')).toBeNull();
    expect(screen.getByText('Qwen')).toBeTruthy();
    expect(screen.queryByRole('option', { name: /google|gemini/i })).toBeNull();

    await user.click(screen.getByRole('option', { name: /anthropic\/claude-sonnet-5/i }));
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toHaveProperty('checked', true);
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/required for this model/i)).toBeTruthy();
  });

  it('does not offer a custom model option or custom model input', async () => {
    const user = userEvent.setup();
    render(<ProviderSetup language="en" saveConfig={async () => undefined} testConnection={async () => undefined} onConfigured={() => undefined} />);

    await user.click(screen.getByRole('combobox', { name: 'Model' }));

    expect(screen.queryByRole('option', { name: /custom model/i })).toBeNull();
    expect(screen.queryByLabelText('Custom model ID')).toBeNull();
  });

  it.each([
    [
      'direct OpenAI',
      { provider: 'openai', apiKey: 'openai-key', model: 'gpt-5.6-sol', customModel: false },
      'openai/gpt-5.6-sol',
      false,
    ],
    [
      'OpenRouter',
      { provider: 'openrouter', apiKey: 'router-key', model: 'qwen/qwen3.7-plus', customModel: false },
      'qwen/qwen3.7-plus',
      true,
    ],
  ] as const)('restores an existing %s configuration', (_name, initialConfig, modelLabel, openRouter) => {
    render(<ProviderSetup language="en" initialConfig={initialConfig as ProviderConfig} saveConfig={async () => undefined} testConnection={async () => undefined} onConfigured={() => undefined} />);
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveProperty('textContent', expect.stringContaining(modelLabel));
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toHaveProperty('checked', openRouter);
  });

  it('does not restore a removed Gemini preset as a supported model', () => {
    render(<ProviderSetup language="en" initialConfig={{
      provider: 'gemini', apiKey: 'google-key', model: 'gemini-3.7-flash', customModel: false,
    } as never} saveConfig={async () => undefined} testConnection={async () => undefined} onConfigured={() => undefined} />);
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveProperty(
      'textContent', expect.stringContaining('openai/gpt-5.6-terra'),
    );
    expect(screen.queryByText('Google')).toBeNull();
  });

  it('falls back to the default curated model for an old custom configuration', () => {
    const initialConfig = {
      provider: 'openrouter', apiKey: 'router-key', model: 'vendor/custom-vision', customModel: true,
    };
    render(<ProviderSetup language="en" initialConfig={initialConfig as never} saveConfig={async () => undefined} testConnection={async () => undefined} onConfigured={() => undefined} />);
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveProperty('textContent', expect.stringContaining('openai/gpt-5.6-terra'));
    expect(screen.queryByLabelText('Custom model ID')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Use OpenRouter' })).toHaveProperty('checked', true);
  });

  it('sends exactly one request when testing the connection and localizes provider errors', async () => {
    const user = userEvent.setup();
    const testConnection = vi.fn(async () => { throw new ProviderError('invalid_api_key'); });
    render(<ProviderSetup language="zh-CN" saveConfig={async () => undefined} testConnection={testConnection} onConfigured={() => undefined} />);
    await user.type(screen.getByLabelText('API 密钥'), 'bad-key');
    expect(screen.getByText(/测试连接会向提供商发送 1 次请求/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '测试连接' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('API 密钥无效'));
    expect(testConnection).toHaveBeenCalledTimes(1);
  });

  it('does not describe a generic OpenRouter rejection as missing image support', async () => {
    const user = userEvent.setup();
    const testConnection = vi.fn(async () => { throw new ProviderError('provider_request_rejected'); });
    render(<ProviderSetup language="zh-CN" saveConfig={async () => undefined} testConnection={testConnection} onConfigured={() => undefined} />);
    await user.type(screen.getByLabelText('API 密钥'), 'router-key');

    await user.click(screen.getByRole('button', { name: '测试连接' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('服务商拒绝了这次请求'),
    );
    expect(screen.queryByText('所选模型不支持图像输入。')).toBeNull();
  });

  it('shows the sanitized OpenRouter rejection summary while testing the connection', async () => {
    const user = userEvent.setup();
    const rejection = attachProviderFailureDetail(new ProviderError('provider_request_rejected'), {
      stage: 'transport',
      issues: [{
        path: 'provider.http.error',
        code: 'request_rejected',
        valuePreview: 'Invalid response_format schema for this request.',
      }],
    });
    render(<ProviderSetup
      language="en"
      saveConfig={async () => undefined}
      testConnection={async () => { throw rejection; }}
      onConfigured={() => undefined}
    />);
    await user.type(screen.getByLabelText('API key'), 'router-key');

    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('Invalid response_format schema for this request.'),
    );
  });

  it('does not duplicate the header-owned language control', () => {
    render(<ProviderSetup language="en" saveConfig={async () => undefined} testConnection={async () => undefined} onConfigured={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Language' })).toBeNull();
  });
});
