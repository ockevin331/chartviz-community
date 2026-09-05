import { ProviderError } from '../../providers/provider-errors';
import {
  attachProviderFailureDetail,
  getProviderFailureDetail,
  validationFailureDetail,
  type AnalysisFailureSnapshot,
  type AnalysisStageSnapshot,
  type ProviderDiagnosticIssue,
  type ProviderDiagnosticStage,
} from '../../providers/provider-diagnostics';
import type { ProviderConfig, StructuredVisionProvider, SupportedImageMediaType } from '../../providers/provider-types';
import { communityReportV3JsonSchema, parseCommunityReportV3Shape, type CommunityReportV3 } from './community-report-v3';
import { mergeCommunityEvidence } from './evidence-bundle';
import { buildEvidenceReasoningPrompt } from './evidence-reasoning-prompt';
import { normalizeCommunitySignalFacts } from './normalize-signals';
import { normalizeCommunityVisualFacts, toCommunityVisualFacts } from './normalize-visual-facts';
import { collectReportQualityWarnings } from './report-quality-warnings';
import { validateCommunityReportV3Semantics } from './report-semantics-v3';
import { communitySignalFactsJsonSchema, parseCommunitySignalFacts } from './signal-facts';
import { buildSignalExtractionPrompt } from './signal-extraction-prompt';
import type { AnalysisWarning, OutputLanguage, StagePageContext } from './shared-stage-types';
import { communityVisualWireJsonSchema, parseCommunityVisualWireFacts } from './visual-facts';
import { buildVisualExtractionPrompt } from './visual-extraction-prompt';

type MutableStageSnapshot = {
  -readonly [Key in keyof AnalysisStageSnapshot]: AnalysisStageSnapshot[Key];
};

const extractionTimeoutMs = 120_000;
const reasoningTimeoutMs = 180_000;

export type AnalysisPipelineProgress =
  | 'preparing'
  | 'reading_chart'
  | 'reviewing_clues'
  | 'checking_signals'
  | 'preparing_result';

export type ThreeStageAnalysisInput = {
  config: ProviderConfig;
  provider: StructuredVisionProvider;
  image: { mediaType: SupportedImageMediaType; dataUrl: string };
  context: StagePageContext;
  outputLanguage: OutputLanguage;
  signal: AbortSignal;
  onProgress?(message: AnalysisPipelineProgress): void;
  onWarning?(warning: AnalysisWarning): void;
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
  snapshot: AnalysisFailureSnapshot,
): never {
  if (error instanceof ProviderError && error.code === 'cancelled') throw error;
  if (error instanceof ProviderError) {
    const detail = getProviderFailureDetail(error);
    const fallbackIssues: readonly ProviderDiagnosticIssue[] = error.httpStatus === undefined
      ? error.code === 'invalid_response'
        ? [{ path: 'provider.response', code: 'missing_failure_detail' }]
        : [{ path: 'provider.transport', code: error.code }]
      : [{ path: 'provider.http.status', code: `http_${error.httpStatus}` }];
    const snapshotWithProviderOutput = detail?.providerOutput === undefined
      ? snapshot
      : {
        ...snapshot,
        stages: snapshot.stages.map((stage, index) => index === snapshot.stages.length - 1
          ? { ...stage, output: detail.providerOutput }
          : stage),
      };
    const stage = error.code !== 'invalid_response' || (detail === null && error.httpStatus !== undefined)
      ? transportStage
      : detail === null
        ? 'response_envelope'
      : detail?.stage === 'report_semantics'
        ? semanticStage
        : detail?.stage === 'response_envelope' || detail?.stage === 'json_parse'
          ? detail.stage
          : shapeStage;
    throw attachProviderFailureDetail(error, {
      stage,
      issues: detail?.issues ?? fallbackIssues,
      ...(detail?.exception === undefined ? {} : { exception: detail.exception }),
      snapshot: snapshotWithProviderOutput,
    });
  }
  const detail = validationFailureDetail(error);
  throw attachProviderFailureDetail(
    new ProviderError('invalid_response', { params: { provider: input.config.provider } }),
    {
      stage: detail.stage === 'report_semantics' ? semanticStage : shapeStage,
      issues: detail.issues,
      ...(detail.exception === undefined ? {} : { exception: detail.exception }),
      snapshot,
    },
  );
}

function semanticError(
  error: unknown,
  input: ThreeStageAnalysisInput,
  stage: ProviderDiagnosticStage,
  snapshot: AnalysisFailureSnapshot,
): never {
  if (error instanceof ProviderError && error.code === 'cancelled') throw error;
  const detail = validationFailureDetail(error);
  throw attachProviderFailureDetail(
    error instanceof ProviderError
      ? error
      : new ProviderError('invalid_response', { params: { provider: input.config.provider } }),
    {
      stage,
      issues: detail.issues as readonly ProviderDiagnosticIssue[],
      ...(detail.exception === undefined ? {} : { exception: detail.exception }),
      snapshot,
    },
  );
}

function stageSnapshot(
  stage: AnalysisStageSnapshot['stage'],
  prompt: { version: string; system: string; user: string },
  schemaName: string,
  hasImage: boolean,
  timeoutMs: number,
): MutableStageSnapshot {
  return {
    stage,
    promptVersion: prompt.version,
    schemaName,
    hasImage,
    timeoutMs,
    inputChars: prompt.system.length + prompt.user.length,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
  };
}

function failureSnapshot(
  input: ThreeStageAnalysisInput,
  stages: readonly MutableStageSnapshot[],
): AnalysisFailureSnapshot {
  return {
    context: { ...input.context },
    outputLanguage: input.outputLanguage,
    stages: stages.map((stage) => ({ ...stage })),
  };
}

export async function runThreeStageAnalysis(input: ThreeStageAnalysisInput): Promise<CommunityReportV3> {
  const stages: MutableStageSnapshot[] = [];
  const emittedWarnings = new Set<string>();
  const emitWarnings = (warnings: readonly AnalysisWarning[]): void => {
    warnings.forEach((warning) => {
      const key = `${warning.stage}:${warning.code}:${JSON.stringify(warning.path)}`;
      if (emittedWarnings.has(key)) return;
      emittedWarnings.add(key);
      input.onWarning?.(warning);
    });
  };
  assertActive(input);
  input.onProgress?.('preparing');
  input.onProgress?.('reading_chart');
  const visualPrompt = buildVisualExtractionPrompt(input.context);
  const visualStage = stageSnapshot('visual_extraction', visualPrompt, 'community_visual_wire', true, extractionTimeoutMs);
  stages.push(visualStage);
  let visualRaw;
  try {
    visualRaw = await input.provider.generateStructured(input.config, {
      systemPrompt: visualPrompt.system,
      userPrompt: visualPrompt.user,
      image: input.image,
      schemaName: 'community_visual_wire',
      jsonSchema: communityVisualWireJsonSchema,
      parse: parseCommunityVisualWireFacts,
      signal: input.signal,
      timeoutMs: extractionTimeoutMs,
      onTrace: (trace) => { visualStage.providerTrace = trace; },
    });
  } catch (error) {
    return classifiedError(error, input, 'visual_extraction_transport', 'visual_extraction_shape', 'visual_extraction_semantics', failureSnapshot(input, stages));
  }
  visualStage.output = visualRaw;
  let visualFacts;
  try { visualFacts = normalizeCommunityVisualFacts(toCommunityVisualFacts(visualRaw, input.context)); }
  catch (error) { return semanticError(error, input, 'visual_extraction_semantics', failureSnapshot(input, stages)); }
  emitWarnings(collectReportQualityWarnings({
    stage: 'visual_extraction',
    value: visualFacts,
    declaredTimeframe: visualFacts.chart.timeframe,
  }));

  assertActive(input);
  input.onProgress?.('reviewing_clues');
  const signalPrompt = buildSignalExtractionPrompt({ context: input.context, facts: visualFacts });
  const signalStage = stageSnapshot('signal_extraction', signalPrompt, 'community_signal_facts', true, extractionTimeoutMs);
  stages.push(signalStage);
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
      timeoutMs: extractionTimeoutMs,
      onTrace: (trace) => { signalStage.providerTrace = trace; },
    });
  } catch (error) {
    return classifiedError(error, input, 'signal_extraction_transport', 'signal_extraction_shape', 'signal_extraction_semantics', failureSnapshot(input, stages));
  }
  signalStage.output = signalRaw;
  let signalFacts;
  try { signalFacts = normalizeCommunitySignalFacts(signalRaw, visualFacts); }
  catch (error) { return semanticError(error, input, 'signal_extraction_semantics', failureSnapshot(input, stages)); }
  emitWarnings(collectReportQualityWarnings({
    stage: 'signal_extraction',
    value: signalFacts,
    declaredTimeframe: visualFacts.chart.timeframe,
  }));

  const evidence = mergeCommunityEvidence(visualFacts, signalFacts);
  assertActive(input);
  input.onProgress?.('checking_signals');
  const reasoningPrompt = buildEvidenceReasoningPrompt({
    context: input.context, evidence, outputLanguage: input.outputLanguage,
  });
  const reasoningStage = stageSnapshot('evidence_reasoning', reasoningPrompt, 'community_report_v3', false, reasoningTimeoutMs);
  stages.push(reasoningStage);
  let reportRaw;
  try {
    reportRaw = await input.provider.generateStructured(input.config, {
      systemPrompt: reasoningPrompt.system,
      userPrompt: reasoningPrompt.user,
      schemaName: 'community_report_v3',
      jsonSchema: communityReportV3JsonSchema,
      parse: parseCommunityReportV3Shape,
      signal: input.signal,
      timeoutMs: reasoningTimeoutMs,
      onTrace: (trace) => { reasoningStage.providerTrace = trace; },
    });
  } catch (error) {
    return classifiedError(error, input, 'evidence_reasoning_transport', 'report_shape', 'report_semantics', failureSnapshot(input, stages));
  }
  reasoningStage.output = reportRaw;
  try {
    const { report, warnings } = validateCommunityReportV3Semantics(
      reportRaw, evidence, input.outputLanguage,
    );
    emitWarnings(warnings);
    input.onProgress?.('preparing_result');
    return report;
  }
  catch (error) { return semanticError(error, input, 'report_semantics', failureSnapshot(input, stages)); }
}
