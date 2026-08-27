import { communityJsonSchema } from '../analysis/community-json-schema';
import { parseCommunityReport } from '../analysis/community-report';
import type { StructuredVisionProvider, VisionProvider } from './provider-types';

/**
 * Keeps the existing single-call controller operational until Task 3 replaces it
 * with the staged orchestrator. Provider implementations stay domain-neutral.
 */
export function withLegacyCommunityAnalysis(provider: StructuredVisionProvider): VisionProvider {
  return {
    kind: provider.kind,
    validateConfig: (config) => provider.validateConfig(config),
    testConnection: (config, signal) => provider.testConnection(config, signal),
    analyze: (config, request) => provider.generateStructured(config, {
      systemPrompt: request.prompt.system,
      userPrompt: request.prompt.user,
      image: request.image,
      schemaName: 'community_report',
      jsonSchema: communityJsonSchema,
      parse: parseCommunityReport,
      signal: request.signal,
    }),
  };
}
