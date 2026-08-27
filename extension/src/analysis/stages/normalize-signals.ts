import type { CommunityVisualFacts } from './visual-facts';
import { calibratedPriceY } from './normalize-visual-facts';
import { parseCommunitySignalFacts, type CommunitySignalFacts } from './signal-facts';

function riskReward(direction: 'long' | 'short', entry: number, stop: number, target: number): string | null {
  const risk = direction === 'long' ? entry - stop : stop - entry;
  const reward = direction === 'long' ? target - entry : entry - target;
  if (risk <= 0 || reward <= 0) return null;
  return `1:${Number((reward / risk).toFixed(2))}`;
}

function coherentNumericSignal(signal: CommunitySignalFacts['signals'][number]): boolean {
  const { price: entry } = signal.entry;
  const { price: stop } = signal.stopLoss;
  if (entry === null || stop === null || signal.takeProfits.some(({ price }) => price === null)) return true;
  const targets = signal.takeProfits.map(({ price }) => price as number);
  return signal.direction === 'long'
    ? stop < entry && targets.every((target) => target > entry)
    : stop > entry && targets.every((target) => target < entry);
}

export function normalizeCommunitySignalFacts(
  value: unknown,
  visualFacts: CommunityVisualFacts,
): CommunitySignalFacts {
  const parsed = parseCommunitySignalFacts(value);
  const signals = parsed.signals.filter(coherentNumericSignal).map((signal) => {
    const stopLoss = {
      ...signal.stopLoss,
      yRatio: signal.stopLoss.price === null
        ? signal.stopLoss.yRatio
        : calibratedPriceY(signal.stopLoss.price, visualFacts.priceScaleAnchors) ?? signal.stopLoss.yRatio,
    };
    const takeProfits = signal.takeProfits.map((target) => ({
      ...target,
      yRatio: target.price === null
        ? target.yRatio
        : calibratedPriceY(target.price, visualFacts.priceScaleAnchors) ?? target.yRatio,
    }));
    const computedRiskReward = signal.entry.price !== null
      && signal.stopLoss.price !== null
      && signal.takeProfits[0]?.price !== null
      && signal.takeProfits[0]?.price !== undefined
      ? riskReward(signal.direction, signal.entry.price, signal.stopLoss.price, signal.takeProfits[0].price)
      : null;
    return {
      ...signal,
      entry: { ...signal.entry },
      stopLoss,
      takeProfits,
      riskReward: computedRiskReward ?? signal.riskReward,
    };
  });
  return parseCommunitySignalFacts({ ...parsed, signals });
}
