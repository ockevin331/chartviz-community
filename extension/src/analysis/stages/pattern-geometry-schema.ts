import { z } from 'zod';

const ratio = z.number().min(0).max(1);
export const patternPointSchema = z.object({ xRatio: ratio, yRatio: ratio }).strict();
const boundarySchema = z.object({
  start: patternPointSchema,
  end: patternPointSchema,
}).strict();

export const patternGeometryShape = z.object({
  geometryKind: z.enum(['polyline', 'channel', 'range']).describe(
    'Use channel for two sloped parallel boundaries, range for horizontal resistance and support, and polyline for other patterns.',
  ),
  points: z.array(patternPointSchema).max(8).describe(
    'Polyline vertices in order. Supply 2-8 only for polyline; otherwise supply an empty array.',
  ),
  upperBoundary: boundarySchema.nullable().describe(
    'Upper channel boundary or horizontal range resistance. Null only for polyline.',
  ),
  lowerBoundary: boundarySchema.nullable().describe(
    'Lower channel boundary or horizontal range support. Null only for polyline.',
  ),
}).strict();

export const patternGeometrySchema = patternGeometryShape.superRefine((geometry, context) => {
  if (geometry.geometryKind === 'polyline') {
    if (geometry.points.length < 2) {
      context.addIssue({ code: 'custom', path: ['points'], message: 'polyline_requires_points' });
    }
    if (geometry.upperBoundary !== null || geometry.lowerBoundary !== null) {
      context.addIssue({ code: 'custom', path: ['geometryKind'], message: 'polyline_cannot_have_boundaries' });
    }
    return;
  }

  if (geometry.points.length !== 0) {
    context.addIssue({ code: 'custom', path: ['points'], message: 'boundary_geometry_cannot_have_points' });
  }
  if (geometry.upperBoundary === null || geometry.lowerBoundary === null) {
    context.addIssue({ code: 'custom', path: ['geometryKind'], message: 'boundary_geometry_requires_two_boundaries' });
  }
});

export type PatternGeometry = z.infer<typeof patternGeometrySchema>;

export function patternGeometryPoints(geometry: PatternGeometry): Array<z.infer<typeof patternPointSchema>> {
  if (geometry.geometryKind === 'polyline') return geometry.points;
  return geometry.upperBoundary === null || geometry.lowerBoundary === null
    ? []
    : [
        geometry.upperBoundary.start,
        geometry.upperBoundary.end,
        geometry.lowerBoundary.start,
        geometry.lowerBoundary.end,
      ];
}
