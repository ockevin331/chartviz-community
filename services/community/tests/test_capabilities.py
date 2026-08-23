from chartviz_community_core import Capabilities as PublicCapabilities
from chartviz_community.capabilities import COMMUNITY_CAPABILITIES, Capabilities


def test_community_capabilities_use_the_public_type() -> None:
    assert Capabilities is PublicCapabilities


def test_community_capabilities_are_stable() -> None:
    assert COMMUNITY_CAPABILITIES.model_dump(by_alias=True) == {
        "edition": "community",
        "apiVersion": "1",
        "reportSchemaVersion": "1.3",
        "limits": {"maxImages": 1, "maxTimeframes": 1},
        "features": {
            "multiTimeframe": False,
            "marketDataFusion": False,
            "advancedAnnotations": False,
            "cloudAuthentication": False,
            "billing": False,
        },
    }
