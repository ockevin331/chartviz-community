import { z } from 'zod';

export const chartContextSchema = z.object({
  site: z.enum([
    'tradingview', 'binance', 'okx', 'bybit', 'hyperliquid', 'coinbase',
    'bitget', 'gate', 'kucoin', 'mexc', 'crypto-com', 'htx', 'upbit',
    '10jqka', 'vergex',
  ]),
  pageType: z.enum([
    'advanced-chart', 'spot-trade', 'futures-trade', 'stock-trade', 'web3-token',
  ]),
  url: z.string().url(),
  symbol: z.string().optional(),
  exchange: z.string().optional(),
  timeframe: z.string().optional(),
  currentOhlcText: z.string().optional(),
  specializedEvidence: z.array(z.enum([
    'cost-distribution', 'liquidation-distribution',
  ])).optional(),
  chart: z.object({
    id: z.string(),
    ariaLabel: z.string().optional(),
    bounds: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  }),
  viewport: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    devicePixelRatio: z.number().positive(),
  }),
});

export type ChartContext = z.infer<typeof chartContextSchema>;
