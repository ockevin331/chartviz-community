from chartviz_community_core import AnalysisReport, AnalysisTask

from factories import make_report


def test_public_report_keeps_the_v13_sections() -> None:
    schema = AnalysisReport.model_json_schema()

    assert {
        "schemaVersion",
        "analysisContext",
        "evidence",
        "marketState",
        "zones",
        "setupEvaluation",
        "decision",
        "insights",
        "patterns",
        "scenarios",
        "drawings",
        "conclusions",
        "indicatorReadings",
        "volumeAnalysis",
        "timeframeAnalyses",
        "tradeSignals",
    } <= set(schema["required"])
    assert make_report().schemaVersion == "1.3"


def test_task_error_has_stable_code_and_readable_text() -> None:
    task = AnalysisTask(
        requestId="c_20260823_0123456789abcdef0123456789abcdef",
        status="failed",
        context={"language": "en"},
        errorCode="CV_RESPONSE_INVALID",
        error="The model response did not match the ChartViz report schema.",
    )

    assert task.errorCode == "CV_RESPONSE_INVALID"


def test_contract_schema_contains_no_cloud_identity_or_billing_types() -> None:
    schema_text = str(AnalysisTask.model_json_schema())

    for forbidden in ("AuthUser", "QuotaView", "Subscription", "Payment"):
        assert forbidden not in schema_text
