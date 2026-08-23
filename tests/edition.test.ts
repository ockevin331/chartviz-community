import { describe, expect, it } from 'vitest';

import { editionForMode } from '../src/config/edition';

describe('extension edition', () => {
  it('defaults every ordinary mode to Cloud', () => {
    expect(editionForMode(undefined)).toBe('cloud');
    expect(editionForMode('production')).toBe('cloud');
    expect(editionForMode('development')).toBe('cloud');
  });

  it('selects Community only for the explicit community mode', () => {
    expect(editionForMode('community')).toBe('community');
  });
});
