from pathlib import Path

from fastapi.testclient import TestClient

from app import main
from app.dorm_reader import DormPage, clean_html, section_chunks
from app.openai_service import _web_sources
from app.schemas import DormResearchAIResult
from app.store import AIStore


def test_clean_html_preserves_headings_lists_and_removes_navigation() -> None:
    html = """
    <html><nav>Housing Home Apply Contact</nav><main>
      <h1>Example Hall</h1><p>Double rooms measure 12 ft by 15 ft.</p>
      <h2>Furniture</h2><ul><li>Desk: 42 in wide</li><li>Twin XL bed</li></ul>
      <script>window.secret = 'ignore';</script>
    </main><footer>Repeated links</footer></html>
    """
    text = clean_html(html)
    assert "# Example Hall" in text
    assert "- Desk: 42 in wide" in text
    assert "Housing Home" not in text
    assert "window.secret" not in text


def test_section_chunks_keep_heading_boundaries() -> None:
    text = "# Hall\n" + "room " * 40 + "\n## Furniture\n" + "desk " * 40
    chunks = section_chunks(text, max_chars=260)
    assert len(chunks) == 2
    assert chunks[0].startswith("# Hall")
    assert chunks[1].startswith("## Furniture")


def test_web_sources_collects_search_results_and_citations_once() -> None:
    sources = _web_sources({"output": [
        {"type": "web_search_call", "action": {"sources": [
            {"url": "https://housing.example.edu/hall", "title": "Example Hall"},
        ]}},
        {"type": "message", "content": [{"type": "output_text", "annotations": [
            {"type": "url_citation", "url": "https://housing.example.edu/hall", "title": "Duplicate"},
            {"type": "url_citation", "url": "https://housing.example.edu/furniture", "title": "Furniture"},
        ]}]},
    ]})
    assert sources == [
        {"url": "https://housing.example.edu/hall", "title": "Example Hall"},
        {"url": "https://housing.example.edu/furniture", "title": "Furniture"},
    ]


def test_research_dorm_returns_validated_sources(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(main, "store", AIStore(tmp_path / "dorm.sqlite", 9, 6))

    async def fake_fetch(url: str, browser_fallback: bool = False) -> DormPage:
        assert browser_fallback is True
        return DormPage(url, "2026-09-26", "abc123", "<h1>Room</h1>", "# Room\nDimensions are 12 ft by 15 ft. Desk is 42 x 24 x 30 inches.", "http")

    class FakeOpenAI:
        enabled = True

        async def structured_response(self, **kwargs):
            assert kwargs["result_type"] is DormResearchAIResult
            return DormResearchAIResult.model_validate({
                "schema_version": "1.0",
                "processing_status": "complete",
                "college": "Example University",
                "residence_hall": "Example Hall",
                "room_type": "Double",
                "room_width_m": 3.6576,
                "room_length_m": 4.572,
                "room_height_m": None,
                "room_confidence": 0.9,
                "room_evidence": [{"source_url": "https://housing.example.edu/hall", "quote": "Dimensions are 12 ft by 15 ft."}],
                "items": [{
                    "name": "Provided desk", "category": "desk", "width_m": 1.0668, "depth_m": 0.6096,
                    "height_m": 0.762, "quantity": 2, "included_with_room": True, "confidence": 0.88,
                    "evidence": [{"source_url": "https://housing.example.edu/hall", "quote": "Desk is 42 x 24 x 30 inches."}],
                }],
                "uncertainties": ["Ceiling height was not listed."],
            }), {"input_tokens": 120, "output_tokens": 80}

    monkeypatch.setattr(main, "fetch_dorm_page", fake_fetch)
    monkeypatch.setattr(main, "openai", FakeOpenAI())
    response = TestClient(main.app).post("/api/v1/research-dorm", json={
        "project_id": "project-demo",
        "college": "Example University",
        "residence_hall": "Example Hall",
        "urls": ["https://housing.example.edu/hall"],
    })
    assert response.status_code == 200
    body = response.json()
    assert body["room_width_m"] == 3.6576
    assert body["items"][0]["quantity"] == 2
    assert body["sources"][0]["raw_hash"] == "abc123"


def test_research_dorm_searches_by_school_and_hall_then_caches_sources(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(main, "store", AIStore(tmp_path / "search.sqlite", 9, 6))
    fetched: list[str] = []

    async def fake_fetch(url: str, browser_fallback: bool = False) -> DormPage:
        fetched.append(url)
        return DormPage(url, "2026-09-26", "source-hash", "<h1>Room</h1>", "# Room\nThe room is 10 ft by 12 ft.", "http")

    class FakeOpenAI:
        enabled = True
        searches = 0

        async def discover_dorm_sources(self, **kwargs):
            self.searches += 1
            assert kwargs["college"] == "Example University"
            assert kwargs["residence_hall"] == "Oak Hall"
            assert kwargs["room_type"] == "Traditional double"
            return [
                {"url": "https://housing.example.edu/oak-hall", "title": "Oak Hall rooms"},
                {"url": "https://reddit.com/r/example", "title": "Student discussion"},
            ], {"input_tokens": 20, "output_tokens": 10}

        async def structured_response(self, **kwargs):
            return DormResearchAIResult.model_validate({
                "schema_version": "1.0", "processing_status": "complete",
                "college": "Example University", "residence_hall": "Oak Hall", "room_type": "Double",
                "room_width_m": 3.048, "room_length_m": 3.6576, "room_height_m": None,
                "room_confidence": 0.9,
                "room_evidence": [{"source_url": "https://housing.example.edu/oak-hall", "quote": "The room is 10 ft by 12 ft."}],
                "items": [], "uncertainties": ["Ceiling height was not listed."],
            }), {"input_tokens": 80, "output_tokens": 40}

    fake_openai = FakeOpenAI()
    monkeypatch.setattr(main, "fetch_dorm_page", fake_fetch)
    monkeypatch.setattr(main, "openai", fake_openai)
    client = TestClient(main.app)
    payload = {
        "project_id": "project-demo", "college": "Example University",
        "residence_hall": "Oak Hall", "room_type": "Traditional double", "urls": [],
    }

    first = client.post("/api/v1/research-dorm", json=payload)
    second = client.post("/api/v1/research-dorm", json=payload)

    assert first.status_code == 200
    assert first.json()["discovered_sources"] == [{"url": "https://housing.example.edu/oak-hall", "title": "Oak Hall rooms"}]
    assert first.json()["needs_manual_sources"] is False
    assert second.status_code == 200
    assert second.json()["status"] == "cached"
    assert fake_openai.searches == 1
    assert fetched == ["https://housing.example.edu/oak-hall", "https://housing.example.edu/oak-hall"]


def test_research_dorm_requests_manual_links_when_search_pages_are_unusable(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(main, "store", AIStore(tmp_path / "fallback.sqlite", 9, 6))

    async def failed_fetch(url: str, browser_fallback: bool = False) -> DormPage:
        raise RuntimeError("robots.txt disallows this page")

    class FakeOpenAI:
        enabled = True

        async def discover_dorm_sources(self, **kwargs):
            return [{"url": "https://housing.example.edu/oak-hall", "title": "Oak Hall"}], {}

    monkeypatch.setattr(main, "fetch_dorm_page", failed_fetch)
    monkeypatch.setattr(main, "openai", FakeOpenAI())
    response = TestClient(main.app).post("/api/v1/research-dorm", json={
        "project_id": "project-demo", "college": "Example University",
        "residence_hall": "Oak Hall", "urls": [],
    })
    assert response.status_code == 200
    assert response.json()["needs_manual_sources"] is True
    assert "Add one or more official housing links" in response.json()["message"]
