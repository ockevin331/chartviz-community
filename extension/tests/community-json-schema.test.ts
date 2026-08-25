import { describe, expect, it } from 'vitest';
import { communityJsonSchema } from '../src/analysis/community-json-schema';

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
};

function schemaAt(...segments: string[]): JsonSchema {
  let current = communityJsonSchema as JsonSchema;
  for (const segment of segments) {
    if (segment === 'items') {
      expect(current.items, `${segments.join('.')} must have items`).toBeDefined();
      current = current.items!;
    } else {
      expect(current.properties?.[segment], `${segments.join('.')} must contain ${segment}`).toBeDefined();
      current = current.properties![segment]!;
    }
  }
  return current;
}

function walkSchema(schema: JsonSchema, path: string, visit: (node: JsonSchema, path: string) => void): void {
  visit(schema, path);
  Object.entries(schema.properties ?? {}).forEach(([key, child]) => walkSchema(child, `${path}.properties.${key}`, visit));
  if (schema.items) walkSchema(schema.items, `${path}.items`, visit);
}

describe('communityJsonSchema', () => {
  it('is directly assignable to the provider contract schema type', () => {
    const providerSchema: Record<string, unknown> = communityJsonSchema;
    expect(providerSchema).toBe(communityJsonSchema);
  });

  it('describes the exact Community v1 root contract', () => {
    expect(communityJsonSchema.type).toBe('object');
    expect(communityJsonSchema.required).toEqual([
      'schemaVersion',
      'chart',
      'marketView',
      'evidence',
      'volume',
      'indicators',
      'levels',
      'scenarios',
      'patterns',
      'signals',
      'riskNotice',
    ]);
    expect(communityJsonSchema.properties!.schemaVersion).toEqual({
      type: 'string',
      enum: ['community-1.0'],
    });
  });

  it('marks every property as required and rejects extras at every object depth', () => {
    const visitedObjectPaths: string[] = [];

    walkSchema(communityJsonSchema as JsonSchema, '$', (node, path) => {
      const types = Array.isArray(node.type) ? node.type : [node.type];
      if (!types.includes('object')) return;
      visitedObjectPaths.push(path);
      expect(node.additionalProperties, `${path} must be strict`).toBe(false);
      expect(node.required, `${path} must declare required fields`).toEqual(Object.keys(node.properties ?? {}));
    });

    expect(visitedObjectPaths).toEqual([
      '$',
      '$.properties.chart',
      '$.properties.marketView',
      '$.properties.evidence.items',
      '$.properties.volume',
      '$.properties.indicators.items',
      '$.properties.levels.items',
      '$.properties.scenarios',
      '$.properties.scenarios.properties.long',
      '$.properties.scenarios.properties.short',
      '$.properties.scenarios.properties.wait',
      '$.properties.patterns.items',
      '$.properties.patterns.items.properties.points.items',
      '$.properties.signals.items',
      '$.properties.signals.items.properties.entry',
      '$.properties.signals.items.properties.stop',
      '$.properties.signals.items.properties.targets.items',
    ]);
  });

  it('uses only the provider-shared JSON Schema keyword and type subset', () => {
    const allowedKeywords = new Set([
      'type',
      'enum',
      'properties',
      'required',
      'additionalProperties',
      'items',
      'minItems',
      'maxItems',
      'minimum',
      'maximum',
    ]);
    const allowedTypes = new Set(['object', 'array', 'string', 'number', 'null']);

    walkSchema(communityJsonSchema as JsonSchema, '$', (node, path) => {
      expect(Object.keys(node).every((key) => allowedKeywords.has(key)), `${path} uses an unsupported keyword`).toBe(true);
      const types = Array.isArray(node.type) ? node.type : [node.type];
      expect(types.every((type) => type !== undefined && allowedTypes.has(type)), `${path} uses an unsupported type`).toBe(true);
    });
  });

  it('represents nullable chart labels, volume, and risk/reward without composition keywords', () => {
    expect(schemaAt('chart', 'instrument').type).toEqual(['string', 'null']);
    expect(schemaAt('chart', 'timeframe').type).toEqual(['string', 'null']);
    expect(schemaAt('volume').type).toEqual(['object', 'null']);
    expect(schemaAt('signals', 'items', 'riskReward').type).toEqual(['string', 'null']);
  });

  it('publishes every enum used by the native report contract', () => {
    expect(schemaAt('marketView', 'bias').enum).toEqual(['bullish', 'bearish', 'sideways', 'unclear']);
    expect(schemaAt('marketView', 'phase').enum).toEqual(['trend', 'range', 'transition', 'unclear']);
    expect(schemaAt('marketView', 'strength').enum).toEqual(['strong', 'moderate', 'weak', 'unclear']);
    expect(schemaAt('evidence', 'items', 'category').enum).toEqual(['price', 'volume', 'indicator', 'level', 'pattern', 'signal']);
    expect(schemaAt('indicators', 'items', 'name').enum).toEqual(['RSI', 'MACD', 'OTHER']);
    expect(schemaAt('levels', 'items', 'type').enum).toEqual(['support', 'resistance']);
    expect(schemaAt('patterns', 'items', 'status').enum).toEqual(['forming', 'confirmed', 'invalidated']);
    expect(schemaAt('patterns', 'items', 'bias').enum).toEqual(['bullish', 'bearish', 'neutral']);
    expect(schemaAt('signals', 'items', 'direction').enum).toEqual(['long', 'short']);
  });

  it('publishes every collection limit from the native report contract', () => {
    expect(schemaAt('evidence').maxItems).toBe(12);
    expect(schemaAt('indicators').maxItems).toBe(4);
    expect(schemaAt('levels').maxItems).toBe(4);
    expect(schemaAt('patterns').maxItems).toBe(3);
    expect(schemaAt('signals').maxItems).toBe(3);
    expect(schemaAt('patterns', 'items', 'points')).toMatchObject({ minItems: 2, maxItems: 8 });
    expect(schemaAt('signals', 'items', 'targets')).toMatchObject({ minItems: 1, maxItems: 3 });
  });

  it.each([
    ['evidence confidence', ['evidence', 'items', 'confidence']],
    ['level y coordinate', ['levels', 'items', 'yRatio']],
    ['pattern confidence', ['patterns', 'items', 'confidence']],
    ['pattern point x coordinate', ['patterns', 'items', 'points', 'items', 'xRatio']],
    ['pattern point y coordinate', ['patterns', 'items', 'points', 'items', 'yRatio']],
    ['signal entry x coordinate', ['signals', 'items', 'entry', 'xRatio']],
    ['signal entry y coordinate', ['signals', 'items', 'entry', 'yRatio']],
    ['signal stop y coordinate', ['signals', 'items', 'stop', 'yRatio']],
    ['signal target y coordinate', ['signals', 'items', 'targets', 'items', 'yRatio']],
    ['signal confidence', ['signals', 'items', 'confidence']],
  ])('publishes inclusive zero-to-one bounds for %s', (_name, path) => {
    expect(schemaAt(...path)).toMatchObject({ type: 'number', minimum: 0, maximum: 1 });
  });
});
