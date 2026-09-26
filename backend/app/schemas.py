from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


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


class NormalizedPoint(StrictModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class DetectedCorner(StrictModel):
    frame_index: int = Field(ge=1, le=3)
    position: NormalizedPoint
    kind: Literal["wall_floor", "wall_ceiling", "wall_wall", "opening", "other"]
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(min_length=1, max_length=180)


class DetectedSurface(StrictModel):
    frame_index: int = Field(ge=1, le=3)
    kind: Literal["wall", "floor", "ceiling"]
    polygon: list[NormalizedPoint] = Field(min_length=3, max_length=8)
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(min_length=1, max_length=180)


class DimensionEstimate(StrictModel):
    dimension: Literal["width", "length", "height"]
    meters: float | None
    confidence: float = Field(ge=0, le=1)
    basis: Literal["confirmed_reference", "visual_estimate", "insufficient_evidence"]
    evidence: str = Field(min_length=1, max_length=180)

    @field_validator("meters")
    @classmethod
    def sensible_estimate(cls, value: float | None) -> float | None:
        if value is not None and not 0.1 <= value <= 30:
            raise ValueError("dimension estimates must be between 0.1 and 30 meters")
        return value


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
    corners: list[DetectedCorner] = Field(max_length=24)
    surfaces: list[DetectedSurface] = Field(max_length=12)
    dimension_estimates: list[DimensionEstimate] = Field(min_length=3, max_length=3)
    uncertainties: list[str] = Field(max_length=12)

    @model_validator(mode="after")
    def one_estimate_per_dimension(self) -> "RoomAIResult":
        if {estimate.dimension for estimate in self.dimension_estimates} != {"width", "length", "height"}:
            raise ValueError("dimension_estimates must contain width, length, and height exactly once")
        return self


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


class FurnitureVisualProfile(StrictModel):
    archetype: Literal["chair", "couch", "desk", "wardrobe", "hamper", "beanbag", "ottoman", "dresser", "lamp", "mirror", "mini_fridge", "box"]
    style: Literal["modern", "traditional", "industrial", "minimal", "soft", "utility"]
    material: Literal["wood", "fabric", "metal", "plastic", "glass", "mixed"]
    silhouette: Literal["slim", "standard", "rounded", "bulky"]
    has_arms: bool
    has_back: bool
    leg_style: Literal["four_leg", "pedestal", "sled", "solid", "none"]
    color_hex: str | None = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(min_length=1, max_length=180)


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
    visual_profile: FurnitureVisualProfile
    price: ExtractedPrice | None
    evidence: list[str] = Field(max_length=12)
    uncertainties: list[str] = Field(max_length=12)


class ProductVisualRequest(StrictModel):
    project_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=180)
    category: str | None = Field(default=None, max_length=80)
    variant: str | None = Field(default=None, max_length=180)


class FurnitureVisualAIResult(StrictModel):
    schema_version: Literal["1.0"]
    processing_status: Literal["complete", "partial"]
    visual_profile: FurnitureVisualProfile


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


class ShoppingSearchRequest(StrictModel):
    project_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    provider: Literal["amazon"]
    query: str = Field(min_length=2, max_length=160)
    category: str | None = Field(default=None, max_length=80)
    max_price_cents: int | None = Field(default=None, ge=1, le=100_000_000)


class ShoppingListing(StrictModel):
    provider: Literal["amazon"]
    external_id: str
    name: str
    source_url: str
    image_url: str | None
    category: str
    variant: str
    width_m: float | None
    depth_m: float | None
    height_m: float | None
    price_cents: int | None
    currency: Literal["USD"]
    observed_at: str
    fit_status: Literal["dimensions_ready", "fit_unverified"]
    evidence: list[str]


class CreateInviteRequest(StrictModel):
    project: dict[str, Any]
    inviter_name: str = Field(min_length=1, max_length=60)
    permission: Literal["view", "edit"] = "edit"
    expires_in_hours: int = Field(default=72, ge=1, le=168)
    max_uses: int = Field(default=5, ge=1, le=20)


class AcceptInviteRequest(StrictModel):
    display_name: str = Field(min_length=1, max_length=60)

    @field_validator("display_name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Enter your name")
        return value


class UpdateInviteProjectRequest(StrictModel):
    project: dict[str, Any]
    expected_revision: int = Field(ge=1)
