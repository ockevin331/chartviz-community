from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Evidence(StrictModel):
    claim: str = Field(min_length=1)
    visualEvidence: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class ImageQuality(StrictModel):
    quality: Literal["high", "medium", "low"]
    limitations: list[str]
    confidence: float = Field(ge=0, le=1)


class MarketReading(StrictModel):
    trend: Literal["bullish", "bearish", "sideways", "unclear"]
    structure: Literal["hh-hl", "lh-ll", "range", "transition", "unclear"]
    evidence: list[Evidence]
    confidence: float = Field(ge=0, le=1)


class Scenario(StrictModel):
    trigger: str = Field(min_length=1)
    confirmation: str = Field(min_length=1)
    invalidation: str = Field(min_length=1)
    targetLogic: str = Field(min_length=1)
    mainRisk: str = Field(min_length=1)


class WaitScenario(StrictModel):
    conditions: str = Field(min_length=1)
    resolution: str = Field(min_length=1)


class Scenarios(StrictModel):
    long: Scenario
    short: Scenario
    wait: WaitScenario


class Decision(StrictModel):
    direction: Literal["long", "short", "wait"]
    status: Literal[
        "waiting_trigger", "waiting_confirmation", "conditions_met", "invalidated"
    ]
    summary: str = Field(min_length=1)
    primaryRisk: str = Field(min_length=1)


class Insight(StrictModel):
    kind: Literal["trend", "structure", "volatility", "volume", "momentum", "indicator"]
    label: str = Field(min_length=1)
    value: str = Field(min_length=1)
    evidence: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class KeyLevel(StrictModel):
    type: Literal[
        "support", "resistance", "breakout_trigger", "breakdown_trigger",
        "trigger", "invalidation", "target",
    ]
    tier: Literal["nearest", "secondary", "major"]
    status: Literal["holding", "testing", "broken", "flip_candidate"]
    priceLabel: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    drawingId: str | None


class Pattern(StrictModel):
    name: str = Field(min_length=1)
    status: Literal["forming", "confirmed", "invalidated"]
    bias: Literal["bullish", "bearish", "neutral"]
    timeRange: str = Field(min_length=1)
    evidence: str = Field(min_length=1)
    confirmation: str = Field(min_length=1)
    invalidation: str = Field(min_length=1)
    drawingRefs: list[str] = Field(min_length=1, max_length=4)
    figureRefs: list[str] = Field(max_length=4)
    confidence: float = Field(ge=0, le=1)


class PricePanelBounds(StrictModel):
    leftRatio: float = Field(ge=0, le=1)
    topRatio: float = Field(ge=0, le=1)
    rightRatio: float = Field(ge=0, le=1)
    bottomRatio: float = Field(ge=0, le=1)


class DrawingPoint(StrictModel):
    timestamp: int | None
    price: float
    timeLabel: str | None
    xRatio: float | None = Field(ge=0, le=1)
    yRatio: float = Field(ge=0, le=1)


class DrawingInstruction(StrictModel):
    id: str = Field(min_length=1)
    tool: Literal[
        "support_line", "resistance_line", "support_zone", "resistance_zone",
        "trend_line", "breakout_marker", "rejection_marker", "time_marker",
        "entry_line", "stop_line", "target_line", "note",
    ]
    label: str = Field(min_length=1)
    points: list[DrawingPoint] = Field(min_length=1, max_length=2)
    reason: str = Field(min_length=1)
    evidenceIds: list[str]
    confidence: float = Field(ge=0, le=1)
    figureId: str | None
    signalDirection: Literal["long", "short"] | None
    renderBounds: PricePanelBounds | None


class SegmentEndpoint(StrictModel):
    timeLabel: str = Field(min_length=1)
    timePrecision: Literal["visible", "interpolated", "relative"]
    price: float
    xRatio: float = Field(ge=0, le=1)
    yRatio: float = Field(ge=0, le=1)


class SegmentAmplitude(StrictModel):
    absolute: float
    percent: float


class SegmentDuration(StrictModel):
    bars: int = Field(ge=1)
    timeLabel: str = Field(min_length=1)


class MarketSegment(StrictModel):
    id: str = Field(min_length=1)
    type: Literal[
        "impulse_up", "pullback_down", "consolidation", "breakout_up",
        "impulse_down", "rebound_up", "breakdown", "transition",
    ]
    parentTrend: Literal["bullish", "bearish", "range", "transition"]
    start: SegmentEndpoint
    end: SegmentEndpoint
    amplitude: SegmentAmplitude
    duration: SegmentDuration
    strength: Literal["strong", "moderate", "weak", "unclear"]
    priceAction: str = Field(min_length=1)
    volumeBehavior: str = Field(min_length=1)
    indicatorSignals: list[str]
    evidence: list[Evidence]
    drawingId: str
    figureRef: str | None
    confidence: float = Field(ge=0, le=1)


class IndicatorReading(StrictModel):
    id: str = Field(min_length=1)
    name: Literal["RSI", "MACD", "OTHER"]
    state: str = Field(min_length=1)
    signals: list[str] = Field(min_length=1)
    timeAnchor: str = Field(min_length=1)
    drawingIds: list[str]
    confidence: float = Field(ge=0, le=1)


class VolumeAnalysis(StrictModel):
    state: Literal["expanding", "contracting", "mixed", "steady", "unclear"]
    priceVolumeRelation: Literal[
        "confirming", "bullish_divergence", "bearish_divergence", "mixed", "unclear"
    ]
    observations: list[Evidence]
    conflictZones: list[str]
    confidence: float = Field(ge=0, le=1)


class PositioningEvidence(StrictModel):
    kind: Literal["cost_concentration", "liquidation_cluster"]
    side: Literal["long", "short", "mixed", "neutral"]
    priceLabel: str | None
    timeAnchor: str = Field(min_length=1)
    observation: str = Field(min_length=1)
    marketImplication: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class AnalysisConclusion(StrictModel):
    id: str = Field(min_length=1)
    timeAnchor: str = Field(min_length=1)
    title: str = Field(min_length=1)
    verdict: str = Field(min_length=1)
    strength: Literal["strong", "moderate", "weak", "unclear"]
    reasoning: str = Field(min_length=1)
    counterEvidence: list[str]
    drawingRefs: list[str] = Field(min_length=1)
    figureRefs: list[str]
    confidence: float = Field(ge=0, le=1)


class TimeframeAnalysis(StrictModel):
    timeframe: str = Field(min_length=1)
    trend: Literal["bullish", "bearish", "sideways", "unclear"]
    structure: Literal["hh-hl", "lh-ll", "range", "transition", "unclear"]
    summary: str = Field(min_length=1)
    evidence: list[str] = Field(min_length=1, max_length=5)
    decision: Literal["long", "short", "wait"]
    confidence: float = Field(ge=0, le=1)


class TradeSignal(StrictModel):
    id: str = Field(pattern=r"^S\d{2}$")
    timeframe: str = Field(min_length=1)
    direction: Literal["long", "short"]
    signalType: str = Field(min_length=1)
    signalTime: str = Field(min_length=1)
    cutoffPoint: str = Field(min_length=1)
    thesisAtSignal: str = Field(min_length=1)
    evidenceAtSignal: list[str] = Field(min_length=1, max_length=6)
    entry: str = Field(min_length=1)
    stopLoss: str = Field(min_length=1)
    takeProfits: list[str] = Field(min_length=1, max_length=3)
    invalidation: str = Field(min_length=1)
    riskReward: str | None
    drawingRefs: list[str] = Field(max_length=4)
    figureRefs: list[str] = Field(max_length=4)
    confidence: float = Field(ge=0, le=1)


class AnalysisNarrative(StrictModel):
    imageQuality: ImageQuality
    marketReading: MarketReading
    bullishEvidence: list[str]
    bearishEvidence: list[str]
    conflicts: list[str]
    dominantBias: Literal["bullish", "bearish", "neutral", "unclear"]
    overallConfidence: float = Field(ge=0, le=1)
    decision: Decision
    insights: list[Insight] = Field(max_length=6)
    keyLevels: list[KeyLevel] = Field(max_length=8)
    patterns: list[Pattern] = Field(max_length=3)
    scenarios: Scenarios
    drawings: list[DrawingInstruction] = Field(max_length=24)
    conclusions: list[AnalysisConclusion] = Field(max_length=6)
    segments: list[MarketSegment] = Field(max_length=8)
    indicatorReadings: list[IndicatorReading] = Field(max_length=8)
    volumeAnalysis: VolumeAnalysis | None
    positioningEvidence: list[PositioningEvidence] = Field(max_length=8)
    timeframeAnalyses: list[TimeframeAnalysis] = Field(max_length=6)
    tradeSignals: list[TradeSignal] = Field(max_length=6)
    riskNotice: str = Field(min_length=1)


class TimeframeRole(StrictModel):
    timeframe: str = Field(min_length=1)
    role: Literal["context", "setup", "trigger", "setup_and_trigger", "supplemental"]


class AnalysisContextV13(StrictModel):
    instrument: str | None = None
    venue: str | None = None
    capturedAt: str | None = None
    timeframes: list[TimeframeRole] = Field(default_factory=list, max_length=3)
    latestCandleClosed: bool | None = None
    dataSources: list[Literal["screenshot", "exchange_api", "calculated", "user_context"]] = Field(
        default_factory=list
    )
    limitations: list[str] = Field(default_factory=list)


class EvidenceReferenceV13(StrictModel):
    id: str = Field(pattern=r"^NE\d{3}$")
    claim: str = Field(min_length=1)
    source: Literal["screenshot", "exchange_api", "calculated", "user_context"]
    timeframe: str | None = None
    timeAnchor: str | None = None
    observationClass: Literal["direct", "estimated", "calculated"]
    confidence: float = Field(ge=0, le=1)


class MarketStateV13(StrictModel):
    regime: Literal["trend", "range", "transition", "insufficient"]
    directionalBias: Literal["bullish", "bearish", "neutral", "unclear"]
    structure: Literal["hh-hl", "lh-ll", "range", "transition", "unclear"]
    currentLocation: str | None
    supportingEvidenceRefs: list[str]
    opposingEvidenceRefs: list[str]
    confidence: float = Field(ge=0, le=1)


class PriceBandV13(StrictModel):
    lower: float | None
    upper: float | None
    label: str = Field(min_length=1)
    precision: Literal["exact", "estimated", "spatial"]


class DecisionZoneV13(StrictModel):
    id: str = Field(pattern=r"^Z\d{2}$")
    type: Literal["support", "resistance", "invalidation"]
    tier: Literal["nearest", "secondary", "major"]
    status: Literal["holding", "testing", "broken", "flip_candidate"]
    band: PriceBandV13
    timeframe: str | None
    score: int = Field(ge=-4, le=8)
    scoreFactors: list[str]
    evidenceRefs: list[str]


class StructuralStopV13(StrictModel):
    band: PriceBandV13
    reason: str = Field(min_length=1)
    buffer: str | None


class SetupTargetV13(StrictModel):
    tier: Literal["T1", "T2", "T3"]
    band: PriceBandV13
    source: Literal["structure", "measured_move", "extension"]
    active: bool
    invalidation: str = Field(min_length=1)


class EffectiveRiskRewardV13(StrictModel):
    gross: float | None = Field(default=None, ge=0)
    net: float | None = Field(default=None, ge=0)
    feeAssumption: str | None = None
    slippageAssumption: str | None = None


class SetupEvaluationV13(StrictModel):
    playbook: Literal["trend_pullback", "range_breakout", "failed_breakout", "none"]
    state: Literal["preparing", "triggered", "invalidated"]
    direction: Literal["long", "short"] | None = None
    location: str | None = None
    premise: str | None = None
    entry: PriceBandV13 | None = None
    trigger: str | None = None
    confirmation: str | None = None
    triggerCandleClosed: bool | None = None
    structuralStop: StructuralStopV13 | None = None
    targets: list[SetupTargetV13] = Field(default_factory=list, max_length=3)
    effectiveRToT1: EffectiveRiskRewardV13 | None = None
    actionability: Literal["TRADE", "WAIT", "NO_TRADE"]
    vetoes: list[str] = Field(default_factory=list)
    pendingConditions: list[str] = Field(default_factory=list)
    whatChangesDecision: list[str] = Field(default_factory=list)
    evidenceRefs: list[str] = Field(default_factory=list)
    opposingEvidenceRefs: list[str] = Field(default_factory=list)


class AnalysisReport(AnalysisNarrative):
    schemaVersion: Literal["1.3"]
    analysisContext: AnalysisContextV13
    evidence: list[EvidenceReferenceV13]
    marketState: MarketStateV13
    zones: list[DecisionZoneV13] = Field(max_length=5)
    setupEvaluation: SetupEvaluationV13


class AnalysisEnvelope(StrictModel):
    requestId: str
    context: dict
    report: AnalysisReport


class AnalysisProgressEvent(StrictModel):
    code: Literal[
        "preparing",
        "reading_chart",
        "reviewing_clues",
        "checking_signals",
        "preparing_result",
    ]
    createdAt: str


AnalysisErrorCode = Literal[
    "CV_IMAGE_INVALID",
    "CV_PROVIDER_TIMEOUT",
    "CV_PROVIDER_ERROR",
    "CV_RESPONSE_INVALID",
    "CV_CANCELLED",
    "CV_INTERNAL_ERROR",
]


class AnalysisTask(StrictModel):
    requestId: str
    status: Literal[
        "pending",
        "processing",
        "awaiting_confirmation",
        "cancel_requested",
        "cancelled",
        "completed",
        "failed",
    ]
    context: dict
    report: AnalysisReport | None = None
    errorCode: AnalysisErrorCode | None = None
    error: str | None = None
    progressEvents: list[AnalysisProgressEvent] = Field(default_factory=list)
