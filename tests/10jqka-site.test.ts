import { describe, expect, it } from 'vitest';
import { normalize10jqkaTimeframe, parse10jqkaStockUrl } from '../src/sites/10jqka/collect-context';
import { isSupportedChartUrl } from '../src/sites/collect-context';

describe('10jqka stock page support', () => {
  it.each([
    ['https://stockpage.10jqka.com.cn/600519/', '600519'],
    ['https://stockpage.10jqka.com.cn/000001/index/', '000001'],
    ['https://stockpage.10jqka.com.cn/AAPL/', 'AAPL'],
    ['https://stockpage.10jqka.com.cn/IXIC/', 'IXIC'],
  ])('parses %s', (url, symbol) => {
    expect(parse10jqkaStockUrl(url)).toEqual({ symbol });
    expect(isSupportedChartUrl(url)).toBe(true);
  });

  it('rejects unrelated pages', () => {
    expect(parse10jqkaStockUrl('https://www.10jqka.com.cn/')).toBeNull();
    expect(parse10jqkaStockUrl('https://stockpage.10jqka.com.cn/')).toBeNull();
  });

  it.each([
    ['日K', '1d'], ['周K', '1w'], ['月K', '1M'], ['60分钟', '1h'], ['15分钟', '15m'],
  ])('normalizes %s', (label, timeframe) => {
    expect(normalize10jqkaTimeframe(label)).toBe(timeframe);
  });
});
