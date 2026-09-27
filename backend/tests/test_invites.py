from pathlib import Path

from fastapi.testclient import TestClient

from app import main
from app.store import InviteStore


def _project() -> dict:
    return {
        "schemaVersion": 1,
        "id": "project-api",
        "name": "API shared room",
        "ownerId": "person-owner",
        "people": [{"id": "person-owner", "name": "Owner", "color": "#527D68"}],
        "room": {},
        "products": [{"id": "product", "screenshotDataUrl": "data:image/png;base64,private"}],
        "items": [],
    }


def test_remote_invite_api_strips_media_and_accepts_member(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(main, "invite_store", InviteStore(tmp_path / "invites.sqlite"))
    client = TestClient(main.app)

    created = client.post(
        "/api/v1/invites",
        json={"project": _project(), "inviter_name": "Owner", "permission": "edit", "expires_in_hours": 24, "max_uses": 2},
    )
    assert created.status_code == 200
    token = created.json()["token"]

    preview = client.get(f"/api/v1/invites/{token}")
    assert preview.status_code == 200
    assert preview.json()["project_name"] == "API shared room"

    accepted = client.post(f"/api/v1/invites/{token}/accept", json={"display_name": "Remote roommate"})
    assert accepted.status_code == 200
    shared = accepted.json()["project"]
    assert "screenshotDataUrl" not in shared["products"][0]
    assert shared["people"][-1]["name"] == "Remote roommate"

    published = client.put(
        f"/api/v1/invites/{token}/project",
        json={"project": {**shared, "name": "Published name"}, "expected_revision": 2},
    )
    assert published.status_code == 200
    assert published.json()["revision"] == 3

    conflict = client.put(
        f"/api/v1/invites/{token}/project",
        json={"project": shared, "expected_revision": 2},
    )
    assert conflict.status_code == 409
