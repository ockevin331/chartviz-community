from __future__ import annotations

from chartviz_community_core import (
    Capabilities,
    CapabilityFeatures,
    CapabilityLimits,
)


COMMUNITY_CAPABILITIES = Capabilities(
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
