import pytest
from pydantic import ValidationError

from app.main import _fallback_visual_profile
from app.schemas import FurnitureVisualPart, FurnitureVisualProfile


def test_deterministic_visual_fallback_handles_supported_names() -> None:
    profile = _fallback_visual_profile("Blue compact refrigerator", "appliance")
    assert profile.archetype == "mini_fridge"
    assert profile.material == "metal"


def test_visual_profile_rejects_renderer_values_outside_allowlist() -> None:
    with pytest.raises(ValidationError):
        FurnitureVisualProfile(
            archetype="arbitrary_mesh",
            style="modern",
            material="wood",
            silhouette="standard",
            has_arms=False,
            has_back=False,
            leg_style="none",
            color_hex=None,
            confidence=0.8,
            evidence="Unsupported value",
            parts=[],
        )


def test_visual_profile_rejects_unsafe_color_text() -> None:
    with pytest.raises(ValidationError):
        FurnitureVisualProfile(
            archetype="desk",
            style="minimal",
            material="wood",
            silhouette="slim",
            has_arms=False,
            has_back=False,
            leg_style="four_leg",
            color_hex="url(javascript:bad)",
            confidence=0.9,
            evidence="Product name says minimal desk",
            parts=[],
        )


def test_visual_profile_accepts_bounded_parametric_parts() -> None:
    part = FurnitureVisualPart(
        primitive="box",
        role="seat",
        position={"x": 0, "y": -0.08, "z": 0},
        size={"x": 0.72, "y": 0.12, "z": 0.64},
        rotation={"x": 0, "y": 0, "z": 0},
        material="fabric",
        color_hex="#A65E45",
    )
    assert part.role == "seat"
    assert part.size.x == 0.72


def test_visual_profile_rejects_parts_outside_collision_box() -> None:
    with pytest.raises(ValidationError, match="inside the normalized collision box"):
        FurnitureVisualPart(
            primitive="box",
            role="back",
            position={"x": 0, "y": 0.45, "z": 0},
            size={"x": 0.8, "y": 0.3, "z": 0.1},
            rotation={"x": 0, "y": 0, "z": 0},
            material="wood",
            color_hex=None,
        )
