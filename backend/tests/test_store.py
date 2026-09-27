from pathlib import Path

import pytest

from app.store import AIStore, InviteConflictError, InviteStore, SpendGuardError


def test_cache_round_trip(tmp_path: Path) -> None:
    store = AIStore(tmp_path / "store.sqlite", total_guard_usd=1.0, max_calls_per_project=2)
    key = store.cache_key("test", "v1", ["a", b"b"])
    store.put_cached(key, "test", {"value": 3})
    assert store.get_cached(key) == {"value": 3}


def test_cleaned_web_page_cache_round_trip(tmp_path: Path) -> None:
    store = AIStore(tmp_path / "store.sqlite", total_guard_usd=1.0, max_calls_per_project=2)
    store.put_web_page("https://housing.example.edu/hall", "hash", "<h1>Hall</h1>", "# Hall", "http")
    page = store.get_web_page("https://housing.example.edu/hall")
    assert page is not None
    assert page["raw_hash"] == "hash"
    assert page["cleaned_text"] == "# Hall"


def test_project_call_limit(tmp_path: Path) -> None:
    store = AIStore(tmp_path / "store.sqlite", total_guard_usd=1.0, max_calls_per_project=1)
    request_id = store.reserve("project", "test", 0.1)
    store.finalize(request_id, 0.02, 100, 20)
    with pytest.raises(SpendGuardError):
        store.reserve("project", "test", 0.1)


def test_aggregate_guard_counts_reservations(tmp_path: Path) -> None:
    store = AIStore(tmp_path / "store.sqlite", total_guard_usd=0.15, max_calls_per_project=3)
    store.reserve("one", "test", 0.1)
    with pytest.raises(SpendGuardError):
        store.reserve("two", "test", 0.1)


def test_invite_accept_and_revision_conflict(tmp_path: Path) -> None:
    invites = InviteStore(tmp_path / "store.sqlite")
    project = {
        "schemaVersion": 1,
        "id": "project-one",
        "name": "Shared dorm",
        "ownerId": "person-owner",
        "people": [{"id": "person-owner", "name": "Owner", "color": "#527D68"}],
        "room": {},
        "products": [],
        "items": [],
    }
    created = invites.create(project, "Owner", "edit", 24, 2)
    accepted = invites.accept(created["token"], "Roommate")

    assert accepted["participant_id"].startswith("person-")
    assert accepted["project"]["people"][-1]["name"] == "Roommate"
    assert invites.preview(created["token"])["remaining_uses"] == 1

    updated = {**accepted["project"], "name": "Updated dorm"}
    assert invites.update_project(created["token"], updated, 2) == {"revision": 3}
    with pytest.raises(InviteConflictError):
        invites.update_project(created["token"], updated, 2)


def test_invite_reuses_a_known_roommate_identity(tmp_path: Path) -> None:
    invites = InviteStore(tmp_path / "store.sqlite")
    project = {
        "schemaVersion": 1,
        "id": "project-one",
        "name": "Shared dorm",
        "ownerId": "person-owner",
        "people": [
            {"id": "person-owner", "name": "Owner", "color": "#527D68"},
            {"id": "person-maya", "name": "Maya", "color": "#D66A4A"},
        ],
        "room": {},
        "products": [],
        "items": [],
    }
    created = invites.create(project, "Owner", "view", 24, 1)
    accepted = invites.accept(created["token"], "  Maya  ")

    assert accepted["participant_id"] == "person-maya"
    assert accepted["permission"] == "view"
    assert len(accepted["project"]["people"]) == 2
