type JsonRecord = Record<string, unknown>;

const unsupportedConstraintKeywords = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'pattern',
]);

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function constraintText(key: string, value: unknown): string {
  return `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`;
}

function appendConstraintDescription(
  description: unknown,
  constraints: readonly string[],
): string | undefined {
  if (constraints.length === 0) {
    return typeof description === 'string' ? description : undefined;
  }
  const suffix = `Transport constraints: ${constraints.join('; ')}.`;
  return typeof description === 'string' && description.trim() !== ''
    ? `${description.trim()} ${suffix}`
    : suffix;
}

function transformNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(transformNode);
  if (!isRecord(value)) return value;

  const constraints = Object.entries(value)
    .filter(([key]) => unsupportedConstraintKeywords.has(key))
    .map(([key, entry]) => constraintText(key, entry));
  const transformed: JsonRecord = {};

  for (const [key, entry] of Object.entries(value)) {
    if (unsupportedConstraintKeywords.has(key) || key === 'description') continue;
    transformed[key] = transformNode(entry);
  }

  const description = appendConstraintDescription(value.description, constraints);
  if (description !== undefined) transformed.description = description;

  if (value.type === 'object' || isRecord(value.properties)) {
    transformed.additionalProperties = false;
  }

  return transformed;
}

export function toAnthropicTransportSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return transformNode(schema) as Record<string, unknown>;
}

