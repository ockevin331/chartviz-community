from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AliasedStrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class CapabilityLimits(AliasedStrictModel):
    max_images: int = Field(alias="maxImages", ge=1)
    max_timeframes: int = Field(alias="maxTimeframes", ge=1)


class CapabilityFeatures(AliasedStrictModel):
    multi_timeframe: bool = Field(alias="multiTimeframe")
    market_data_fusion: bool = Field(alias="marketDataFusion")
    advanced_annotations: bool = Field(alias="advancedAnnotations")
    cloud_authentication: bool = Field(alias="cloudAuthentication")
    billing: bool


class Capabilities(AliasedStrictModel):
    edition: Literal["community", "cloud"]
    api_version: Literal["1"] = Field(alias="apiVersion")
    report_schema_version: Literal["1.3"] = Field(alias="reportSchemaVersion")
    limits: CapabilityLimits
    features: CapabilityFeatures
