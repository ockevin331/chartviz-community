import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CommunityConnectionPanel } from '../entrypoints/floating-panel/CommunityConnectionPanel';

describe('Community connection panel', () => {
  it.each([
    ['en' as const, ['Backend URL', 'Local token', 'Show token', 'Test and save']],
    ['zh-CN' as const, ['后端地址', '本地 Token', '显示 Token', '测试并保存']],
  ])('renders a localized secret-safe setup form in %s', (language, expected) => {
    const markup = renderToStaticMarkup(
      <CommunityConnectionPanel language={language} onConnected={() => undefined} />,
    );

    expected.forEach((text) => expect(markup).toContain(text));
    expect(markup).toContain('http://127.0.0.1:8000');
    expect(markup).not.toMatch(/Log in|Register|Plan|Pricing|Analysis list|\/register|\/login/);
  });

  it('shows connected metadata without rendering the saved token', () => {
    const secret = 'local-token-with-32-characters-000';
    const markup = renderToStaticMarkup(
      <CommunityConnectionPanel
        language="en"
        initialConnection={{
          connected: true,
          baseUrl: 'https://charts.example.com',
          hasStoredToken: true,
          modelId: 'vision-model',
        }}
        onConnected={() => undefined}
      />,
    );

    expect(markup).toContain('https://charts.example.com');
    expect(markup).toContain('vision-model');
    expect(markup).toContain('Stored token');
    expect(markup).not.toContain(secret);
  });
});
