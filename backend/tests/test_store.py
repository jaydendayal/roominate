from pathlib import Path

import pytest

from app.store import AIStore, SpendGuardError


def test_cache_round_trip(tmp_path: Path) -> None:
    store = AIStore(tmp_path / "store.sqlite", total_guard_usd=1.0, max_calls_per_project=2)
    key = store.cache_key("test", "v1", ["a", b"b"])
    store.put_cached(key, "test", {"value": 3})
    assert store.get_cached(key) == {"value": 3}


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

