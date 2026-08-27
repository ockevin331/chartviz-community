import { z } from 'zod';
import { assertScreenshotOnlyText } from '../source-policy';

const text = z.string().trim().min(1);
const ratio = z.number().min(0).max(1);
const signalPrice = z.object({
  priceLabel: text,
  price: z.number().nullable(),
  yRatio: ratio,
}).strict();

const signalFactsShape = z.object({
  schemaVersion: z.literal('community-signals-1.0'),
  signals: z.array(z.object({
    id: z.string().regex(/^S\d{2}$/),
    direction: z.enum(['long', 'short']),
    signalType: text,
    signalTime: text,
    thesisAtSignal: text,
    evidenceAtSignal: z.array(text).min(1).max(6),
    entry: z.object({
      priceLabel: text,
      price: z.number().nullable(),
      xRatio: ratio,
      yRatio: ratio,
    }).strict(),
    stopLoss: signalPrice,
    takeProfits: z.array(signalPrice).min(1).max(3),
    riskReward: text.nullable(),
    confidence: ratio,
  }).strict()).max(4),
}).strict();

function collectStrings(value: unknown, result: string[] = []): string[] {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, result));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, result));
  return result;
}

export const communitySignalFactsSchema = signalFactsShape.superRefine((facts, context) => {
  const ids = new Set<string>();
  facts.signals.forEach(({ id }, index) => {
    if (ids.has(id)) context.addIssue({ code: 'custom', path: ['signals', index, 'id'], message: 'duplicate_id' });
    ids.add(id);
  });
  collectStrings(facts).forEach((value) => {
    try { assertScreenshotOnlyText(value); }
    catch {
      context.addIssue({ code: 'custom', path: [], message: 'external_source_claim' });
    }
  });
});

export type CommunitySignalFacts = z.infer<typeof communitySignalFactsSchema>;
export const communitySignalFactsJsonSchema = z.toJSONSchema(signalFactsShape, { target: 'draft-7' });

export function parseCommunitySignalFacts(value: unknown): CommunitySignalFacts {
  return communitySignalFactsSchema.parse(value);
}
