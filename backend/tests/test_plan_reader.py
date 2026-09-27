import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main
from app.plan_reader import parse_length_text, reviewed_plan_reading
from app.schemas import FloorPlanAIResult, TracedWall
from app.store import AIStore

WALLS = [
    {"label": "A", "start": {"x": 0.1, "y": 0.1}, "end": {"x": 0.9, "y": 0.1}},
    {"label": "B", "start": {"x": 0.9, "y": 0.1}, "end": {"x": 0.9, "y": 0.8}},
    {"label": "C", "start": {"x": 0.9, "y": 0.8}, "end": {"x": 0.1, "y": 0.8}},
    {"label": "D", "start": {"x": 0.1, "y": 0.8}, "end": {"x": 0.1, "y": 0.1}},
]


def _model_result() -> FloorPlanAIResult:
    return FloorPlanAIResult.model_validate({
        "schema_version": "1.0",
        "processing_status": "complete",
        "dimensions": [
            {"text": "12'-6\"", "spans": "wall", "wall_label": "A", "confidence": 0.9, "evidence": "Label above wall A"},
            {"text": "3.2 m", "spans": "overall_length", "wall_label": None, "confidence": 0.8, "evidence": "Label beside the room"},
            {"text": "about twelve feet", "spans": "wall", "wall_label": "B", "confidence": 0.4, "evidence": "Handwritten note"},
            {"text": "9'", "spans": "wall", "wall_label": "Z", "confidence": 0.7, "evidence": "Label near a wall that was not traced"},
            {"text": "36\"", "spans": "other", "wall_label": None, "confidence": 0.9, "evidence": "Door width"},
        ],
        "openings": [
            {"kind": "door", "label": "Entry door", "wall_label": "B", "position": {"x": 0.9, "y": 0.3}, "width_ratio": 0.25, "confidence": 0.85, "evidence": "Swing arc on B"},
            {"kind": "window", "label": "Window", "wall_label": "Q", "position": {"x": 0.5, "y": 0.1}, "width_ratio": None, "confidence": 0.7, "evidence": "Parallel lines at top"},
        ],
        "uncertainties": [],
    })


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), "#c9c09c").save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.mark.parametrize(("text", "meters"), [
    ("12'-6\"", 3.81),
    ("12' 6 1/2\"", 3.8227),
    ("12 ft 6 in", 3.81),
    ("13’-2”", 4.0132),
    ("11'", 3.3528),
    ("3.81 m", 3.81),
    ("3,81 m", 3.81),
    ("381 cm", 3.81),
    ("3,810 mm", 3.81),
])
def test_printed_dimensions_parse_to_meters(text: str, meters: float) -> None:
    assert parse_length_text(text) == pytest.approx(meters, abs=1e-4)


@pytest.mark.parametrize("text", ["12", "about twelve feet", "12' x 10'", "0\"", "", "1/0\""])
def test_text_without_a_stated_length_is_not_a_measurement(text: str) -> None:
    assert parse_length_text(text) is None


def test_reading_keeps_only_lengths_the_printed_text_supports() -> None:
    reading = reviewed_plan_reading(_model_result(), [TracedWall.model_validate(wall) for wall in WALLS])
    assert [(dimension["spans"], dimension["wall_label"], dimension["meters"]) for dimension in reading["dimensions"]] == [
        ("wall", "A", 3.81),
        ("overall_length", None, 3.2),
    ]
    assert [opening["wall_label"] for opening in reading["openings"]] == ["B", None]


class _FakeOpenAI:
    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled
        self.calls: list[dict] = []

    async def structured_response(self, **kwargs):
        self.calls.append(kwargs)
        return _model_result(), {"input_tokens": 10, "output_tokens": 5}


@pytest.fixture
def client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setattr(main, "store", AIStore(tmp_path / "ai.sqlite", total_guard_usd=1.0, max_calls_per_project=5))
    return TestClient(main.app)


def _post(client: TestClient, walls: str = json.dumps(WALLS)):
    return client.post(
        "/api/v1/read-floor-plan",
        data={"project_id": "project-plan", "walls": walls},
        files=[("files", ("plan.png", _png(), "image/png")), ("files", ("traced.png", _png(), "image/png"))],
    )


def test_floor_plan_reading_falls_back_without_a_key(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(main, "openai", _FakeOpenAI(enabled=False))
    response = _post(client)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "manual_fallback"
    assert body["dimensions"] == [] and body["openings"] == []


def test_floor_plan_reading_uses_code_parsed_lengths_and_caches(client: TestClient, monkeypatch) -> None:
    fake = _FakeOpenAI(enabled=True)
    monkeypatch.setattr(main, "openai", fake)
    body = _post(client).json()
    assert body["status"] == "complete"
    assert body["dimensions"][0] == {"text": "12'-6\"", "spans": "wall", "wall_label": "A", "confidence": 0.9, "evidence": "Label above wall A", "meters": 3.81}
    assert fake.calls[0]["image_detail"] == "high"
    assert len(fake.calls[0]["images"]) == 2
    assert _post(client).json()["status"] == "cached"
    assert len(fake.calls) == 1


def test_floor_plan_reading_rejects_malformed_walls(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(main, "openai", _FakeOpenAI(enabled=True))
    assert _post(client, "not json").status_code == 422
    assert _post(client, json.dumps(WALLS[:2])).status_code == 422
    assert _post(client, json.dumps([{**WALLS[0], "label": "a1"}, *WALLS[1:]])).status_code == 422
