import { describe, expect, it } from 'vitest';
import { toAnthropicTransportSchema } from '../src/providers/anthropic-transport-schema';

describe('Claude transport schema', () => {
  it('removes unsupported constraints recursively without mutating the application schema', () => {
    const applicationSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      description: 'Root object.',
      properties: {
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Model confidence.',
        },
        id: {
          type: 'string',
          minLength: 1,
          maxLength: 20,
          pattern: '^S\\d{2}$',
        },
        values: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              score: { type: 'number', exclusiveMinimum: 0, multipleOf: 0.1 },
            },
            required: ['score'],
          },
        },
      },
      required: ['confidence', 'id', 'values'],
    } satisfies Record<string, unknown>;
    const original = structuredClone(applicationSchema);

    const transported = toAnthropicTransportSchema(applicationSchema);
    const serialized = JSON.stringify(transported);

    expect(transported).not.toBe(applicationSchema);
    expect(applicationSchema).toEqual(original);
    expect(transported).not.toHaveProperty('$schema');
    for (const keyword of [
      'minimum', 'maximum', 'exclusiveMinimum', 'multipleOf',
      'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems',
    ]) {
      expect(serialized).not.toContain(`"${keyword}"`);
    }
    expect(transported).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        confidence: {
          type: 'number',
          description: expect.stringContaining('Model confidence.'),
        },
        id: {
          type: 'string',
          description: expect.stringContaining('^S\\d{2}$'),
        },
        values: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              score: {
                type: 'number',
                description: expect.stringContaining('multipleOf=0.1'),
              },
            },
          },
        },
      },
      required: ['confidence', 'id', 'values'],
    });
    expect((transported.properties as Record<string, any>).confidence.description)
      .toContain('minimum=0');
    expect((transported.properties as Record<string, any>).confidence.description)
      .toContain('maximum=1');
    expect((transported.properties as Record<string, any>).values.description)
      .toContain('minItems=1');
  });

  it('preserves structural unions, enums, nullability, and required membership', () => {
    const applicationSchema = {
      anyOf: [
        {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['long', 'short'] },
            price: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          },
          required: ['direction', 'price'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    } satisfies Record<string, unknown>;

    expect(toAnthropicTransportSchema(applicationSchema)).toEqual(applicationSchema);
  });

  it('overrides permissive nested objects while leaving non-schema data values intact', () => {
    const applicationSchema = {
      type: 'object',
      properties: {
        metadata: {
          type: 'object',
          additionalProperties: true,
          properties: {
            example: {
              type: 'string',
              description: 'Literal words such as minimum and pattern are ordinary prose.',
            },
          },
          required: ['example'],
        },
      },
      required: ['metadata'],
      additionalProperties: true,
    } satisfies Record<string, unknown>;

    const transported = toAnthropicTransportSchema(applicationSchema);

    expect(transported).toMatchObject({
      additionalProperties: false,
      properties: {
        metadata: {
          additionalProperties: false,
          properties: {
            example: {
              description: 'Literal words such as minimum and pattern are ordinary prose.',
            },
          },
        },
      },
    });
  });
});
