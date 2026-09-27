from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NormalizedPoint(StrictModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class TracedWall(StrictModel):
    label: str = Field(pattern=r"^[A-Z]{1,2}$")
    start: NormalizedPoint
    end: NormalizedPoint


class FloorPlanDimension(StrictModel):
    text: str = Field(min_length=1, max_length=40)
    spans: Literal["wall", "overall_width", "overall_length", "other"]
    wall_label: str | None = Field(max_length=2)
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(min_length=1, max_length=180)


class FloorPlanOpening(StrictModel):
    kind: Literal["door", "window", "closet", "radiator", "obstacle"]
    label: str = Field(min_length=1, max_length=80)
    wall_label: str | None = Field(max_length=2)
    position: NormalizedPoint
    width_ratio: float | None = Field(ge=0.02, le=1)
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(min_length=1, max_length=180)


class FloorPlanAIResult(StrictModel):
    schema_version: Literal["1.0"]
    processing_status: Literal["complete", "partial"]
    dimensions: list[FloorPlanDimension] = Field(max_length=16)
    openings: list[FloorPlanOpening] = Field(max_length=12)
    uncertainties: list[str] = Field(max_length=8)


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


class ParametricVector(StrictModel):
    x: float
    y: float
    z: float


class FurnitureVisualPart(StrictModel):
    primitive: Literal["box", "cylinder", "sphere", "cone"]
    role: Literal["body", "top", "seat", "back", "arm", "leg", "base", "door", "drawer", "shelf", "cushion", "shade", "handle", "other"]
    position: ParametricVector
    size: ParametricVector
    rotation: ParametricVector
    material: Literal["wood", "fabric", "metal", "plastic", "glass", "mixed"]
    color_hex: str | None = Field(pattern=r"^#[0-9a-fA-F]{6}$")

    @model_validator(mode="after")
    def bounded_part(self) -> "FurnitureVisualPart":
        for axis in ("x", "y", "z"):
            center = getattr(self.position, axis)
            size = getattr(self.size, axis)
            rotation = getattr(self.rotation, axis)
            if not -0.5 <= center <= 0.5:
                raise ValueError("part centers must stay inside the normalized collision box")
            if not 0.02 <= size <= 1:
                raise ValueError("part sizes must be normalized fractions between 0.02 and 1")
            if abs(center) + size / 2 > 0.53:
                raise ValueError("part geometry must stay inside the normalized collision box")
            if not -180 <= rotation <= 180:
                raise ValueError("part rotations must be degrees between -180 and 180")
        return self


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
    parts: list[FurnitureVisualPart] = Field(max_length=24)


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


class DormResearchRequest(StrictModel):
    project_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    college: str = Field(min_length=2, max_length=160)
    residence_hall: str = Field(min_length=2, max_length=160)
    room_type: str | None = Field(default=None, max_length=120)
    urls: list[HttpUrl] = Field(default_factory=list, max_length=5)


class DormDimensionEvidence(StrictModel):
    source_url: str
    quote: str = Field(min_length=1, max_length=240)


class DormItemExtraction(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    category: Literal["bed", "desk", "dresser", "wardrobe", "chair", "bookshelf", "mini_fridge", "other"]
    width_m: float | None
    depth_m: float | None
    height_m: float | None
    quantity: int = Field(ge=1, le=8)
    included_with_room: bool
    confidence: float = Field(ge=0, le=1)
    evidence: list[DormDimensionEvidence] = Field(max_length=4)

    @field_validator("width_m", "depth_m", "height_m")
    @classmethod
    def sensible_item_dimension(cls, value: float | None) -> float | None:
        if value is not None and not 0.02 <= value <= 10:
            raise ValueError("dorm item dimensions must be between 0.02 and 10 meters")
        return value


class DormResearchAIResult(StrictModel):
    schema_version: Literal["1.0"]
    processing_status: Literal["complete", "partial"]
    college: str = Field(min_length=2, max_length=160)
    residence_hall: str | None = Field(max_length=160)
    room_type: str | None = Field(max_length=160)
    room_width_m: float | None
    room_length_m: float | None
    room_height_m: float | None
    room_confidence: float = Field(ge=0, le=1)
    room_evidence: list[DormDimensionEvidence] = Field(max_length=6)
    items: list[DormItemExtraction] = Field(max_length=20)
    uncertainties: list[str] = Field(max_length=12)

    @field_validator("room_width_m", "room_length_m", "room_height_m")
    @classmethod
    def sensible_room_dimension(cls, value: float | None) -> float | None:
        if value is not None and not 0.5 <= value <= 30:
            raise ValueError("dorm room dimensions must be between 0.5 and 30 meters")
        return value


class LayoutPositionSummary(StrictModel):
    item_id: str = Field(min_length=1, max_length=160)
    name: str = Field(min_length=1, max_length=160)
    category: str = Field(min_length=1, max_length=80)
    x_m: float = Field(ge=0, le=30)
    y_m: float = Field(ge=0, le=30)
    rotation_degrees: int = Field(ge=0, le=359)


class LayoutCandidateSummary(StrictModel):
    candidate_id: str = Field(min_length=1, max_length=60, pattern=r"^[a-z0-9_-]+$")
    label: str = Field(min_length=1, max_length=120)
    placed_count: int = Field(ge=0, le=200)
    unplaced_count: int = Field(ge=0, le=200)
    positions: list[LayoutPositionSummary] = Field(max_length=200)


class RecommendLayoutRequest(StrictModel):
    project_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    room_type: str = Field(max_length=120)
    room_width_m: float = Field(gt=0, le=30)
    room_length_m: float = Field(gt=0, le=30)
    priorities: list[str] = Field(max_length=12)
    candidates: list[LayoutCandidateSummary] = Field(min_length=1, max_length=3)


class LayoutRecommendationAIResult(StrictModel):
    schema_version: Literal["1.0"]
    processing_status: Literal["complete", "partial"]
    candidate_id: str = Field(min_length=1, max_length=60)
    rationale: str = Field(min_length=1, max_length=360)


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
