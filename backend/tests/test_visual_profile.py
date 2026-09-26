import pytest
from pydantic import ValidationError

from app.main import _fallback_visual_profile
from app.schemas import FurnitureVisualProfile


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
        )
