from pathlib import Path

from fastapi.testclient import TestClient

from app import main
from app.schemas import LayoutRecommendationAIResult
from app.store import AIStore


def request_payload() -> dict:
    return {
        "project_id": "project-layout",
        "room_type": "Shared dorm",
        "room_width_m": 3.6,
        "room_length_m": 4.2,
        "priorities": ["Keep a clear entry", "Preserve workspace"],
        "candidates": [
            {
                "candidate_id": "balanced", "label": "Balanced perimeter layout", "placed_count": 2, "unplaced_count": 0,
                "positions": [
                    {"item_id": "desk", "name": "Desk", "category": "desk", "x_m": 2.8, "y_m": 3.8, "rotation_degrees": 0},
                    {"item_id": "chair", "name": "Chair", "category": "chair", "x_m": 2.8, "y_m": 3.0, "rotation_degrees": 180},
                ],
            },
            {
                "candidate_id": "open_center", "label": "Open-center layout", "placed_count": 2, "unplaced_count": 0,
                "positions": [
                    {"item_id": "desk", "name": "Desk", "category": "desk", "x_m": 1.0, "y_m": 3.8, "rotation_degrees": 0},
                    {"item_id": "chair", "name": "Chair", "category": "chair", "x_m": 1.0, "y_m": 3.0, "rotation_degrees": 180},
                ],
            },
        ],
    }


def test_ai_selects_only_from_collision_tested_layout_candidates(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(main, "store", AIStore(tmp_path / "layout.sqlite", 9, 6))

    class FakeOpenAI:
        enabled = True

        async def structured_response(self, **kwargs):
            assert kwargs["result_type"] is LayoutRecommendationAIResult
            assert "do not recalculate or alter coordinates" in kwargs["system_prompt"]
            return LayoutRecommendationAIResult.model_validate({
                "schema_version": "1.0", "processing_status": "complete", "candidate_id": "open_center",
                "rationale": "Keeps the center open while preserving the desk and chair pairing.",
            }), {"input_tokens": 120, "output_tokens": 30}

    monkeypatch.setattr(main, "openai", FakeOpenAI())
    response = TestClient(main.app).post("/api/v1/recommend-layout", json=request_payload())
    assert response.status_code == 200
    assert response.json()["candidate_id"] == "open_center"
    assert response.json()["status"] == "complete"


def test_layout_recommendation_has_a_no_key_fallback(monkeypatch) -> None:
    class DisabledOpenAI:
        enabled = False

    monkeypatch.setattr(main, "openai", DisabledOpenAI())
    response = TestClient(main.app).post("/api/v1/recommend-layout", json=request_payload())
    assert response.status_code == 200
    assert response.json()["candidate_id"] == "balanced"
    assert response.json()["status"] == "manual_fallback"
