import { describe, expect, it } from 'vitest';
import {
  classifyChartAvailability,
  findSupportedSiteByChartUrl,
  supportedSites,
} from '../src/sites/supported-sites';

describe('supported site registry', () => {
  it('classifies an unknown domain without inventing a site', () => {
    expect(classifyChartAvailability('https://gmgn.ai/sol/token/example')).toEqual({
      code: 'unsupported_site',
      onChartVizSite: false,
    });
  });

  it('classifies ChartViz separately for same-page upload guidance', () => {
    expect(classifyChartAvailability('https://www.chartviz.xyz/')).toEqual({
      code: 'unsupported_site',
      onChartVizSite: true,
    });
  });

  it('returns the current supported site and its BTC example for a wrong URL', () => {
    expect(classifyChartAvailability('https://www.binance.com/en/markets')).toEqual({
      code: 'unsupported_url',
      site: 'binance',
      siteName: 'Binance',
      exampleUrl: 'https://www.binance.com/en/trade/BTC_USDT?type=spot',
    });
  });

  it('accepts valid localized and site-specific chart URLs', () => {
    expect(classifyChartAvailability('https://www.binance.com/zh-CN/trade/BTC_USDT?type=spot')).toBeNull();
    expect(findSupportedSiteByChartUrl('https://vergex.trade/chart?symbol=BTC&exchange=3c1d0438-8a57-4a2e-ad90-68069c247367')?.id).toBe('vergex');
  });

  it('defines one non-empty BTC example and manifest boundary for every advertised site', () => {
    for (const site of supportedSites) {
      expect(new URL(site.exampleBtcUrl).protocol).toBe('https:');
      expect(site.contentMatches.length).toBeGreaterThan(0);
      expect(site.hostPermissions.length).toBeGreaterThan(0);
    }
  });
});
