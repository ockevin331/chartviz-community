import { describe, expect, it } from 'vitest';

import { installAction } from '../src/platform/install-behavior';

describe('extension install behavior', () => {
  it('does not open a ChartViz website from Community installations', () => {
    expect(installAction('community', 'en')).toEqual({ kind: 'none' });
  });

  it('keeps the Cloud welcome page', () => {
    expect(installAction('cloud', 'en')).toEqual({
      kind: 'open-tab',
      url: 'https://www.chartviz.xyz/?source=extension-install&language=en',
    });
  });

  it('passes the selected Cloud language to the welcome page', () => {
    expect(installAction('cloud', 'zh-CN')).toEqual({
      kind: 'open-tab',
      url: 'https://www.chartviz.xyz/?source=extension-install&language=zh-CN',
    });
  });
});
