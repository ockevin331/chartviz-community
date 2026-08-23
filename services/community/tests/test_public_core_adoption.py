from chartviz_community_core import AnalysisReport as PublicAnalysisReport
from chartviz_community.repository import AnalysisReport as RepositoryAnalysisReport


def test_community_repository_uses_the_public_report_class() -> None:
    assert RepositoryAnalysisReport is PublicAnalysisReport
