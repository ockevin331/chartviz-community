// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mountFloatingPanel } from '../src/capture/mount-floating-panel';

afterEach(() => {
  document.getElementById('chartviz-community-panel')?.remove();
});

describe('v1 floating panel layout', () => {
  it('fills the browser height with the v1 width and right offset', () => {
    mountFloatingPanel('chrome-extension://chartviz/panel.html');

    const panel = document.getElementById('chartviz-community-panel');
    expect(panel).not.toBeNull();
    expect(panel?.style.top).toBe('0px');
    expect(panel?.style.right).toBe('12px');
    expect(panel?.style.width).toBe('400px');
    expect(panel?.style.maxWidth).toBe('calc(100vw - 24px)');
    expect(panel?.style.height).toBe('100vh');
    expect(panel?.style.maxHeight).toBe('100dvh');
    expect(panel?.style.borderRadius).toBe('0px');
  });

  it('delegates clipboard writes to the embedded extension panel', () => {
    mountFloatingPanel('chrome-extension://chartviz/panel.html');

    const frame = document.querySelector<HTMLIFrameElement>('#chartviz-community-panel iframe');
    expect(frame?.getAttribute('allow')).toBe('clipboard-write');
  });

  it('removes an injected empty srcdoc so the extension URL remains loadable', async () => {
    mountFloatingPanel('chrome-extension://chartviz/panel.html');

    const frame = document.querySelector<HTMLIFrameElement>('#chartviz-community-panel iframe');
    frame?.setAttribute('srcdoc', '');
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(frame?.hasAttribute('srcdoc')).toBe(false);
    expect(frame?.getAttribute('src')).toBe('chrome-extension://chartviz/panel.html');
  });

  it('renders chart identity as v1 vertical metadata rows', () => {
    const css = readFileSync(resolve(process.cwd(), 'entrypoints/panel/style.css'), 'utf8');
    expect(css).toMatch(/\.chart-context\s*\{[^}]*display:\s*block/s);
    expect(css).toMatch(/\.chart-context div\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*82px minmax\(0,\s*1fr\)/s);
  });
});
