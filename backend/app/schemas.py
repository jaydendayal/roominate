from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PaletteCandidate(StrictModel):
    hex: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    label: str = Field(min_length=1, max_length=60)
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(min_length=1, max_length=180)


class ProposedFeature(StrictModel):
    kind: Literal["door", "window", "closet", "radiator", "obstacle"]
    label: str = Field(min_length=1, max_length=80)
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(min_length=1, max_length=180)


class RoomGeometryDraft(StrictModel):
    width_m: float | None
    length_m: float | None
    height_m: float | None
    notes: list[str] = Field(max_length=8)
    features: list[ProposedFeature] = Field(max_length=12)

    @field_validator("width_m", "length_m", "height_m")
    @classmethod
    def sensible_room_dimension(cls, value: float | None) -> float | None:
        if value is not None and not 0.1 <= value <= 30:
            raise ValueError("room dimensions must be between 0.1 and 30 meters")
        return value


class RoomAIResult(StrictModel):
    schema_version: Literal["1.0"]
    processing_status: Literal["complete", "partial"]
    palette: list[PaletteCandidate] = Field(min_length=1, max_length=5)
    room: RoomGeometryDraft


class ProductDimensions(StrictModel):
    width_m: float | None
    depth_m: float | None
    height_m: float | None

    @field_validator("width_m", "depth_m", "height_m")
    @classmethod
    def sensible_dimension(cls, value: float | None) -> float | None:
        if value is not None and not 0 < value <= 30:
            raise ValueError("product dimensions must be between 0 and 30 meters")
        return value


class ExtractedPrice(StrictModel):
    amount_cents: int = Field(ge=0, le=100_000_000)
    currency: Literal["USD"]
    evidence: str = Field(min_length=1, max_length=180)
    confidence: float = Field(ge=0, le=1)


class ProductAIResult(StrictModel):
    schema_version: Literal["1.0"]
    processing_status: Literal["complete", "partial"]
    name: str | None
    store: str | None
    source_url: str | None
    category: str | None
    variant: str | None
    dimensions: ProductDimensions
    price: ExtractedPrice | None
    evidence: list[str] = Field(max_length=12)
    uncertainties: list[str] = Field(max_length=12)


class UrlImportRequest(StrictModel):
    project_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    url: HttpUrl


class ProposalChangeInput(StrictModel):
    change_id: str = Field(min_length=1, max_length=120)
    deterministic_reason: str = Field(min_length=1, max_length=600)
    deterministic_impact: str = Field(min_length=1, max_length=600)


class ExplainProposalRequest(StrictModel):
    project_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    priorities: list[str] = Field(max_length=20)
    changes: list[ProposalChangeInput] = Field(max_length=20)
    before_subtotal_cents: int = Field(ge=0)
    after_subtotal_cents: int = Field(ge=0)


class Explanation(StrictModel):
    change_id: str
    explanation: str = Field(min_length=1, max_length=360)


class ExplanationAIResult(StrictModel):
    schema_version: Literal["1.0"]
    processing_status: Literal["complete", "partial"]
    explanations: list[Explanation] = Field(max_length=20)

