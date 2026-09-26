from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any


class SpendGuardError(RuntimeError):
    pass


class AIStore:
    def __init__(self, path: Path, total_guard_usd: float, max_calls_per_project: int) -> None:
        self.path = path
        self.total_guard_usd = total_guard_usd
        self.max_calls_per_project = max_calls_per_project
        self._lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS cache (
                    cache_key TEXT PRIMARY KEY,
                    operation TEXT NOT NULL,
                    result_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS requests (
                    request_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    status TEXT NOT NULL,
                    reserved_usd REAL NOT NULL,
                    actual_usd REAL,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                """
            )

    @staticmethod
    def cache_key(operation: str, schema_version: str, parts: list[bytes | str]) -> str:
        digest = hashlib.sha256()
        digest.update(operation.encode())
        digest.update(schema_version.encode())
        for part in parts:
            digest.update(part if isinstance(part, bytes) else part.encode())
        return digest.hexdigest()

    def get_cached(self, key: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT result_json FROM cache WHERE cache_key = ?", (key,)).fetchone()
        return json.loads(row["result_json"]) if row else None

    def put_cached(self, key: str, operation: str, value: dict[str, Any]) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO cache(cache_key, operation, result_json) VALUES (?, ?, ?)",
                (key, operation, json.dumps(value, separators=(",", ":"))),
            )

    def reserve(self, project_id: str, operation: str, estimated_usd: float) -> str:
        request_id = str(uuid.uuid4())
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            project_count = connection.execute(
                "SELECT COUNT(*) AS count FROM requests WHERE project_id = ? AND status IN ('reserved', 'complete')",
                (project_id,),
            ).fetchone()["count"]
            if project_count >= self.max_calls_per_project:
                raise SpendGuardError(f"This project reached its {self.max_calls_per_project}-call AI limit.")
            spent = connection.execute(
                "SELECT COALESCE(SUM(CASE WHEN status = 'complete' THEN actual_usd ELSE reserved_usd END), 0) AS total FROM requests WHERE status IN ('reserved', 'complete')"
            ).fetchone()["total"]
            if float(spent) + estimated_usd > self.total_guard_usd:
                raise SpendGuardError("The aggregate OpenAI spend guard is reached; manual tools remain available.")
            connection.execute(
                "INSERT INTO requests(request_id, project_id, operation, status, reserved_usd) VALUES (?, ?, ?, 'reserved', ?)",
                (request_id, project_id, operation, estimated_usd),
            )
        return request_id

    def finalize(self, request_id: str, actual_usd: float, input_tokens: int, output_tokens: int) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE requests SET status = 'complete', actual_usd = ?, input_tokens = ?, output_tokens = ? WHERE request_id = ?",
                (actual_usd, input_tokens, output_tokens, request_id),
            )

    def fail(self, request_id: str) -> None:
        with self._connect() as connection:
            connection.execute("UPDATE requests SET status = 'failed', actual_usd = 0 WHERE request_id = ?", (request_id,))

    def stats(self) -> dict[str, float | int]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT COALESCE(SUM(CASE WHEN status = 'complete' THEN actual_usd WHEN status = 'reserved' THEN reserved_usd ELSE 0 END), 0) AS total, COUNT(CASE WHEN status = 'complete' THEN 1 END) AS calls FROM requests"
            ).fetchone()
        return {"tracked_spend_usd": round(float(row["total"]), 6), "completed_calls": int(row["calls"]), "guard_usd": self.total_guard_usd}

