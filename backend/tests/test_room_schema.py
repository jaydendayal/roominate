import pytest
from pydantic import ValidationError

from app.schemas import RoomAIResult


def valid_result() -> dict:
    return {
        "schema_version": "1.0",
        "processing_status": "partial",
        "palette": [{"hex": "#EEEBDD", "label": "wall", "confidence": 0.7, "evidence": "Frame 1 center wall"}],
        "room": {"width_m": 3.2, "length_m": None, "height_m": None, "notes": [], "features": []},
        "corners": [{"frame_index": 1, "position": {"x": 0.25, "y": 0.8}, "kind": "wall_floor", "confidence": 0.9, "evidence": "Frame 1 lower-left intersection"}],
        "surfaces": [{"frame_index": 1, "kind": "floor", "polygon": [{"x": 0.0, "y": 0.7}, {"x": 1.0, "y": 0.7}, {"x": 1.0, "y": 1.0}], "confidence": 0.8, "evidence": "Frame 1 visible floor"}],
        "dimension_estimates": [
            {"dimension": "width", "meters": 3.2, "confidence": 1, "basis": "confirmed_reference", "evidence": "User reference"},
            {"dimension": "length", "meters": None, "confidence": 0, "basis": "insufficient_evidence", "evidence": "Rear boundary occluded"},
            {"dimension": "height", "meters": 2.5, "confidence": 0.45, "basis": "visual_estimate", "evidence": "Scaled from width"},
        ],
        "uncertainties": ["Rear wall is partly occluded"],
    }


def test_room_vision_observations_validate() -> None:
    result = RoomAIResult.model_validate(valid_result())
    assert result.corners[0].position.x == 0.25
    assert result.dimension_estimates[1].meters is None


def test_room_feature_placement_is_bounded_and_reviewable() -> None:
    payload = valid_result()
    payload["room"]["features"] = [{
        "kind": "window",
        "label": "Rear window",
        "wall": "north",
        "offset_ratio": 0.7,
        "width_m": 1.2,
        "depth_m": 0.08,
        "height_m": 1.0,
        "elevation_m": 0.9,
        "confidence": 0.82,
        "evidence": "Frame 1 rear wall",
    }]
    result = RoomAIResult.model_validate(payload)
    assert result.room.features[0].wall == "north"
    assert result.room.features[0].offset_ratio == 0.7


def test_normalized_corner_rejects_out_of_frame_coordinate() -> None:
    payload = valid_result()
    payload["corners"][0]["position"]["x"] = 1.2
    with pytest.raises(ValidationError):
        RoomAIResult.model_validate(payload)


def test_dimension_assessments_require_each_dimension_once() -> None:
    payload = valid_result()
    payload["dimension_estimates"][2]["dimension"] = "width"
    with pytest.raises(ValidationError):
        RoomAIResult.model_validate(payload)
