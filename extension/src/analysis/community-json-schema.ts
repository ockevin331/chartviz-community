type JsonSchema = {
  type: string | string[];
  enum?: readonly string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
};

function objectSchema(properties: Record<string, JsonSchema>, nullable = false): JsonSchema {
  return {
    type: nullable ? ['object', 'null'] : 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function arraySchema(items: JsonSchema, bounds: { minItems?: number; maxItems?: number } = {}): JsonSchema {
  return { type: 'array', items, ...bounds };
}

const text = (): JsonSchema => ({ type: 'string' });
const nullableText = (): JsonSchema => ({ type: ['string', 'null'] });
const choice = (...values: string[]): JsonSchema => ({ type: 'string', enum: values });
const normalizedNumber = (): JsonSchema => ({ type: 'number', minimum: 0, maximum: 1 });
const evidenceIds = (): JsonSchema => arraySchema(text());

const evidence = objectSchema({
  id: text(),
  category: choice('price', 'volume', 'indicator', 'level', 'pattern', 'signal'),
  observation: text(),
  implication: text(),
  timeAnchor: text(),
  confidence: normalizedNumber(),
});

const observation = (nullable = false): JsonSchema => objectSchema({
  summary: text(),
  evidenceIds: evidenceIds(),
}, nullable);

const indicator = objectSchema({
  name: choice('RSI', 'MACD', 'OTHER'),
  summary: text(),
  implication: text(),
  evidenceIds: evidenceIds(),
});

const level = objectSchema({
  id: text(),
  type: choice('support', 'resistance'),
  priceLabel: text(),
  reason: text(),
  timeAnchor: text(),
  yRatio: normalizedNumber(),
  evidenceIds: evidenceIds(),
});

const scenario = (): JsonSchema => objectSchema({
  condition: text(),
  entry: text(),
  stop: text(),
  targets: arraySchema(text()),
  reason: text(),
  evidenceIds: evidenceIds(),
});

const waitScenario = objectSchema({
  condition: text(),
  reason: text(),
  evidenceIds: evidenceIds(),
});

const point = objectSchema({
  xRatio: normalizedNumber(),
  yRatio: normalizedNumber(),
});

const pattern = objectSchema({
  id: text(),
  name: text(),
  status: choice('forming', 'confirmed', 'invalidated'),
  bias: choice('bullish', 'bearish', 'neutral'),
  timeRange: text(),
  explanation: text(),
  confidence: normalizedNumber(),
  points: arraySchema(point, { minItems: 2, maxItems: 8 }),
  evidenceIds: evidenceIds(),
});

const signalPrice = (): JsonSchema => objectSchema({
  priceLabel: text(),
  yRatio: normalizedNumber(),
});

const signal = objectSchema({
  id: text(),
  direction: choice('long', 'short'),
  timeAnchor: text(),
  reason: text(),
  entry: objectSchema({
    priceLabel: text(),
    xRatio: normalizedNumber(),
    yRatio: normalizedNumber(),
  }),
  stop: signalPrice(),
  targets: arraySchema(signalPrice(), { minItems: 1, maxItems: 3 }),
  riskReward: nullableText(),
  confidence: normalizedNumber(),
  evidenceIds: evidenceIds(),
});

export const communityJsonSchema = objectSchema({
  schemaVersion: choice('community-1.0'),
  chart: objectSchema({
    instrument: nullableText(),
    timeframe: nullableText(),
    limitations: arraySchema(text()),
  }),
  marketView: objectSchema({
    bias: choice('bullish', 'bearish', 'sideways', 'unclear'),
    phase: choice('trend', 'range', 'transition', 'unclear'),
    strength: choice('strong', 'moderate', 'weak', 'unclear'),
    summary: text(),
    evidenceIds: evidenceIds(),
  }),
  evidence: arraySchema(evidence, { maxItems: 12 }),
  volume: observation(true),
  indicators: arraySchema(indicator, { maxItems: 4 }),
  levels: arraySchema(level, { maxItems: 4 }),
  scenarios: objectSchema({
    long: scenario(),
    short: scenario(),
    wait: waitScenario,
  }),
  patterns: arraySchema(pattern, { maxItems: 3 }),
  signals: arraySchema(signal, { maxItems: 3 }),
  riskNotice: text(),
});
