from chartviz_community_core import AnalysisReport, AnalysisTask

from factories import make_report


def test_report_requires_the_v13_public_sections() -> None:
    required = set(AnalysisReport.model_json_schema()["required"])

    assert {
        "schemaVersion",
        "analysisContext",
        "evidence",
        "marketState",
        "zones",
        "setupEvaluation",
        "decision",
        "drawings",
        "tradeSignals",
    } <= required
    assert make_report().schemaVersion == "1.3"


def test_task_contract_accepts_both_edition_states_and_stable_errors() -> None:
    schema = AnalysisTask.model_json_schema()
    status_values = set(schema["properties"]["status"]["enum"])

    assert {
        "awaiting_confirmation",
        "cancel_requested",
        "completed",
        "failed",
    } <= status_values
    assert "errorCode" in schema["properties"]
