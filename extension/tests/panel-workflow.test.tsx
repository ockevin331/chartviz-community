// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../entrypoints/panel/App';
import type { VisionProvider } from '../src/providers/provider-types';
import { annotatedImages, communityReport, processedImage } from './community-ui-fixtures';

afterEach(cleanup);

describe('direct Community panel workflow', () => {
  it('runs configured source → preview → analyzing → completed with one request and no internal detail', async () => {
    const user = userEvent.setup();
    const analyze = vi.fn(async () => communityReport);
    const provider: VisionProvider = { kind: 'openrouter', validateConfig: () => ({ ok: true }), testConnection: async () => undefined, analyze };
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      readUpload: async () => processedImage,
      getProvider: () => provider,
      buildAnnotations: async () => annotatedImages,
    }} />);
    await screen.findByRole('heading', { name: 'Choose chart image' });
    const input = screen.getByLabelText('Upload one chart image');
    await user.upload(input, new File(['chart'], 'chart.png', { type: 'image/png' }));
    await screen.findByRole('img', { name: 'Chart ready for analysis' });
    await user.click(screen.getByRole('button', { name: 'Analyze screenshot' }));
    await screen.findByText('Reading chart');
    await screen.findByText('Higher lows remain visible.');
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/system prompt|payload|json schema|chain-of-thought/i);
  });

  it('keeps the v1 close and drag interactions on the floating panel header', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage');
    render(<App dependencies={{ loadConfig: async () => null }} />);
    await screen.findByRole('heading', { name: 'Connect your own vision model' });
    expect(screen.getByRole('heading', { name: 'ChartViz' })).toBeTruthy();
    expect(screen.queryByText('ChartViz Community')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Language' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(postMessage).toHaveBeenCalledWith({ source: 'chartviz', type: 'panel-close' }, '*');
    const header = screen.getByTestId('drag-handle');
    header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, screenX: 20, screenY: 20 }));
    header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, screenX: 25, screenY: 22 }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ source: 'chartviz', type: 'panel-drag', dx: 5, dy: 2 }, '*'));
  });

  it('refreshes the panel workflow without reloading the page or calling the provider', async () => {
    const user = userEvent.setup();
    const analyze = vi.fn(async () => communityReport);
    const provider: VisionProvider = { kind: 'openrouter', validateConfig: () => ({ ok: true }), testConnection: async () => undefined, analyze };
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'openai/gpt-5.6-terra', customModel: false }),
      readUpload: async () => processedImage,
      getProvider: () => provider,
    }} />);
    await screen.findByRole('heading', { name: 'Choose chart image' });
    await user.upload(screen.getByLabelText('Upload one chart image'), new File(['chart'], 'chart.png', { type: 'image/png' }));
    await screen.findByRole('img', { name: 'Chart ready for analysis' });

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByRole('heading', { name: 'Choose chart image' })).toBeTruthy();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('localizes a malformed provider report without exposing validation or schema details', async () => {
    const user = userEvent.setup();
    const provider: VisionProvider = {
      kind: 'openrouter', validateConfig: () => ({ ok: true }), testConnection: async () => undefined,
      analyze: async () => ({ schemaVersion: 'private-bad-version', chart: { privatePath: 'chart.timeframe' } } as never),
    };
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      readUpload: async () => processedImage,
      getProvider: () => provider,
    }} />);
    await screen.findByRole('heading', { name: 'Choose chart image' });
    await user.upload(screen.getByLabelText('Upload one chart image'), new File(['chart'], 'chart.png', { type: 'image/png' }));
    await user.click(await screen.findByRole('button', { name: 'Analyze screenshot' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The provider returned an invalid report.');
    expect(document.body.textContent).not.toMatch(/schemaVersion|private-bad-version|chart\.timeframe|invalid_type|Zod/i);
  });
});
