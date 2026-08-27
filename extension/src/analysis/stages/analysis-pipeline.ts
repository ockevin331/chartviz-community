import { ProviderError } from '../../providers/provider-errors';
import {
  attachProviderFailureDetail,
  getProviderFailureDetail,
  validationFailureDetail,
  type ProviderDiagnosticIssue,
  type ProviderDiagnosticStage,
} from '../../providers/provider-diagnostics';
import type { ProviderConfig, StructuredVisionProvider, SupportedImageMediaType } from '../../providers/provider-types';
import { communityReportV3JsonSchema, parseCommunityReportV3, type CommunityReportV3 } from './community-report-v3';
import { mergeCommunityEvidence } from './evidence-bundle';
import { buildEvidenceReasoningPrompt } from './evidence-reasoning-prompt';
import { normalizeCommunitySignalFacts } from './normalize-signals';
import { normalizeCommunityVisualFacts } from './normalize-visual-facts';
import { validateCommunityReportV3Semantics } from './report-semantics-v3';
import { communitySignalFactsJsonSchema, parseCommunitySignalFacts } from './signal-facts';
import { buildSignalExtractionPrompt } from './signal-extraction-prompt';
import type { OutputLanguage, StagePageContext } from './shared-stage-types';
import { communityVisualFactsJsonSchema, parseCommunityVisualFacts } from './visual-facts';
import { buildVisualExtractionPrompt } from './visual-extraction-prompt';

export type AnalysisPipelineProgress = 'reading_chart' | 'organizing_evidence' | 'preparing_result';

export type ThreeStageAnalysisInput = {
  config: ProviderConfig;
  provider: StructuredVisionProvider;
  image: { mediaType: SupportedImageMediaType; dataUrl: string };
  context: StagePageContext;
  outputLanguage: OutputLanguage;
  signal: AbortSignal;
  onProgress?(message: AnalysisPipelineProgress): void;
};

function cancelled(provider: ProviderConfig['provider']): ProviderError {
  return new ProviderError('cancelled', { params: { provider } });
}

function assertActive(input: ThreeStageAnalysisInput): void {
  if (input.signal.aborted) throw cancelled(input.config.provider);
}

function classifiedError(
  error: unknown,
  input: ThreeStageAnalysisInput,
  transportStage: ProviderDiagnosticStage,
  shapeStage: ProviderDiagnosticStage,
  semanticStage: ProviderDiagnosticStage,
): never {
  if (error instanceof ProviderError && error.code === 'cancelled') throw error;
  if (error instanceof ProviderError) {
    const detail = getProviderFailureDetail(error);
    const stage = error.code !== 'invalid_response'
      ? transportStage
      : detail?.stage === 'report_semantics'
        ? semanticStage
        : shapeStage;
    throw attachProviderFailureDetail(error, { stage, issues: detail?.issues ?? [] });
  }
  const detail = validationFailureDetail(error);
  throw attachProviderFailureDetail(
    new ProviderError('invalid_response', { params: { provider: input.config.provider } }),
    { stage: detail.stage === 'report_semantics' ? semanticStage : shapeStage, issues: detail.issues },
  );
}

function semanticError(
  error: unknown,
  input: ThreeStageAnalysisInput,
  stage: ProviderDiagnosticStage,
): never {
  if (error instanceof ProviderError && error.code === 'cancelled') throw error;
  const detail = validationFailureDetail(error);
  throw attachProviderFailureDetail(
    error instanceof ProviderError
      ? error
      : new ProviderError('invalid_response', { params: { provider: input.config.provider } }),
    { stage, issues: detail.issues as readonly ProviderDiagnosticIssue[] },
  );
}

export async function runThreeStageAnalysis(input: ThreeStageAnalysisInput): Promise<CommunityReportV3> {
  assertActive(input);
  input.onProgress?.('reading_chart');
  const visualPrompt = buildVisualExtractionPrompt(input.context);
  let visualRaw;
  try {
    visualRaw = await input.provider.generateStructured(input.config, {
      systemPrompt: visualPrompt.system,
      userPrompt: visualPrompt.user,
      image: input.image,
      schemaName: 'community_visual_facts',
      jsonSchema: communityVisualFactsJsonSchema,
      parse: parseCommunityVisualFacts,
      signal: input.signal,
    });
  } catch (error) {
    return classifiedError(error, input, 'visual_extraction_transport', 'visual_extraction_shape', 'visual_extraction_semantics');
  }
  let visualFacts;
  try { visualFacts = normalizeCommunityVisualFacts(visualRaw); }
  catch (error) { return semanticError(error, input, 'visual_extraction_semantics'); }

  assertActive(input);
  input.onProgress?.('organizing_evidence');
  const signalPrompt = buildSignalExtractionPrompt({ context: input.context, facts: visualFacts });
  let signalRaw;
  try {
    signalRaw = await input.provider.generateStructured(input.config, {
      systemPrompt: signalPrompt.system,
      userPrompt: signalPrompt.user,
      image: input.image,
      schemaName: 'community_signal_facts',
      jsonSchema: communitySignalFactsJsonSchema,
      parse: parseCommunitySignalFacts,
      signal: input.signal,
    });
  } catch (error) {
    return classifiedError(error, input, 'signal_extraction_transport', 'signal_extraction_shape', 'signal_extraction_semantics');
  }
  let signalFacts;
  try { signalFacts = normalizeCommunitySignalFacts(signalRaw, visualFacts); }
  catch (error) { return semanticError(error, input, 'signal_extraction_semantics'); }

  const evidence = mergeCommunityEvidence(visualFacts, signalFacts);
  assertActive(input);
  input.onProgress?.('preparing_result');
  const reasoningPrompt = buildEvidenceReasoningPrompt({
    context: input.context, evidence, outputLanguage: input.outputLanguage,
  });
  let reportRaw;
  try {
    reportRaw = await input.provider.generateStructured(input.config, {
      systemPrompt: reasoningPrompt.system,
      userPrompt: reasoningPrompt.user,
      schemaName: 'community_report_v3',
      jsonSchema: communityReportV3JsonSchema,
      parse: parseCommunityReportV3,
      signal: input.signal,
    });
  } catch (error) {
    return classifiedError(error, input, 'evidence_reasoning_transport', 'report_shape', 'report_semantics');
  }
  try { return validateCommunityReportV3Semantics(reportRaw, evidence, input.outputLanguage); }
  catch (error) { return semanticError(error, input, 'report_semantics'); }
}
