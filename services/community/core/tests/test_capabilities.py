from chartviz_community_core import (
    Capabilities,
    CapabilityFeatures,
    CapabilityLimits,
)


def test_capabilities_serialize_with_public_aliases() -> None:
    value = Capabilities(
        edition="community",
        apiVersion="1",
        reportSchemaVersion="1.3",
        limits=CapabilityLimits(maxImages=1, maxTimeframes=1),
        features=CapabilityFeatures(
            multiTimeframe=False,
            marketDataFusion=False,
            advancedAnnotations=False,
            cloudAuthentication=False,
            billing=False,
        ),
    )

    assert value.model_dump(mode="json", by_alias=True) == {
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
