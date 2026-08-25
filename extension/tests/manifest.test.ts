import { describe, expect, it } from 'vitest';
import { createManifest } from '../wxt.config';

describe('extension manifest', () => {
  it('uses only the approved minimum permissions and provider origins', () => {
    const manifest = createManifest();

    expect(manifest.permissions).toEqual(['activeTab', 'storage', 'scripting']);
    expect(manifest.host_permissions).toEqual([
      'https://openrouter.ai/api/*',
      'https://api.openai.com/v1/*',
      'https://generativelanguage.googleapis.com/*',
    ]);
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
    expect(manifest.optional_host_permissions).toBeUndefined();
  });
});
