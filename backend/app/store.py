from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import threading
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


class SpendGuardError(RuntimeError):
    pass


class InviteError(RuntimeError):
    """A safe, user-facing invite failure."""


class InviteConflictError(InviteError):
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
                CREATE TABLE IF NOT EXISTS web_pages (
                    source_url TEXT PRIMARY KEY,
                    raw_hash TEXT NOT NULL,
                    cleaned_text TEXT NOT NULL,
                    fetch_method TEXT NOT NULL,
                    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS web_raw_pages (
                    source_url TEXT PRIMARY KEY,
                    raw_hash TEXT NOT NULL,
                    raw_html TEXT NOT NULL,
                    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

    def get_web_page(self, source_url: str, max_age_hours: int = 24) -> dict[str, str] | None:
        freshness = f"-{max(1, max_age_hours)} hours"
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM web_pages WHERE source_url = ? AND fetched_at >= datetime('now', ?)",
                (source_url, freshness),
            ).fetchone()
        return dict(row) if row else None

    def put_web_page(self, source_url: str, raw_hash: str, raw_html: str, cleaned_text: str, fetch_method: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """INSERT OR REPLACE INTO web_raw_pages(source_url, raw_hash, raw_html, fetched_at)
                   VALUES (?, ?, ?, CURRENT_TIMESTAMP)""",
                (source_url, raw_hash, raw_html),
            )
            connection.execute(
                """INSERT OR REPLACE INTO web_pages(source_url, raw_hash, cleaned_text, fetch_method, fetched_at)
                   VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)""",
                (source_url, raw_hash, cleaned_text, fetch_method),
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


class InviteStore:
    """Token-based development collaboration with optimistic revisions.

    Only a hash of the bearer token is persisted. Possession of the original
    token grants the permission selected by the person creating the invite.
    """

    COLORS = ("#D66A4A", "#527D68", "#C3913D", "#6F74A8", "#A35D83", "#467C8C")

    def __init__(self, path: Path) -> None:
        self.path = path
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
                CREATE TABLE IF NOT EXISTS invites (
                    token_hash TEXT PRIMARY KEY,
                    project_json TEXT NOT NULL,
                    project_name TEXT NOT NULL,
                    inviter_name TEXT NOT NULL,
                    permission TEXT NOT NULL CHECK(permission IN ('view', 'edit')),
                    expires_at TEXT NOT NULL,
                    max_uses INTEGER NOT NULL,
                    use_count INTEGER NOT NULL DEFAULT 0,
                    revision INTEGER NOT NULL DEFAULT 1,
                    revoked INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS invite_members (
                    token_hash TEXT NOT NULL,
                    name_key TEXT NOT NULL,
                    person_id TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(token_hash, name_key),
                    FOREIGN KEY(token_hash) REFERENCES invites(token_hash) ON DELETE CASCADE
                );
                """
            )

    @staticmethod
    def _hash(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    @staticmethod
    def _active(row: sqlite3.Row) -> None:
        if row["revoked"]:
            raise InviteError("This invite has been revoked.")
        if datetime.fromisoformat(row["expires_at"]) <= datetime.now(UTC):
            raise InviteError("This invite has expired.")

    def create(self, project: dict[str, Any], inviter_name: str, permission: str, expires_in_hours: int, max_uses: int) -> dict[str, Any]:
        token = secrets.token_urlsafe(32)
        token_hash = self._hash(token)
        expires_at = datetime.now(UTC) + timedelta(hours=expires_in_hours)
        project_json = json.dumps(project, separators=(",", ":"), allow_nan=False)
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO invites(
                    token_hash, project_json, project_name, inviter_name,
                    permission, expires_at, max_uses
                ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (token_hash, project_json, str(project["name"]), inviter_name, permission, expires_at.isoformat(), max_uses),
            )
        return {"token": token, "expires_at": expires_at.isoformat(), "permission": permission, "revision": 1}

    def preview(self, token: str) -> dict[str, Any]:
        token_hash = self._hash(token)
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM invites WHERE token_hash = ?", (token_hash,)).fetchone()
        if not row:
            raise InviteError("This invite link is invalid.")
        self._active(row)
        return {
            "project_name": row["project_name"],
            "inviter_name": row["inviter_name"],
            "permission": row["permission"],
            "expires_at": row["expires_at"],
            "remaining_uses": max(0, row["max_uses"] - row["use_count"]),
        }

    def accept(self, token: str, display_name: str) -> dict[str, Any]:
        token_hash = self._hash(token)
        display_name = " ".join(display_name.split())
        if not display_name:
            raise InviteError("Enter your name.")
        name_key = display_name.casefold()
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT * FROM invites WHERE token_hash = ?", (token_hash,)).fetchone()
            if not row:
                raise InviteError("This invite link is invalid.")
            self._active(row)
            member = connection.execute(
                "SELECT person_id FROM invite_members WHERE token_hash = ? AND name_key = ?",
                (token_hash, name_key),
            ).fetchone()
            if not member and row["use_count"] >= row["max_uses"]:
                raise InviteError("This invite has reached its collaborator limit.")

            project = json.loads(row["project_json"])
            people = project.setdefault("people", [])
            if member:
                person_id = member["person_id"]
                revision = row["revision"]
            else:
                existing = next((person for person in people if str(person.get("name", "")).casefold() == name_key), None)
                person_id = str(existing["id"]) if existing else f"person-{uuid.uuid4()}"
                if not existing:
                    people.append({"id": person_id, "name": display_name, "color": self.COLORS[len(people) % len(self.COLORS)]})
                connection.execute(
                    "INSERT INTO invite_members(token_hash, name_key, person_id, display_name) VALUES (?, ?, ?, ?)",
                    (token_hash, name_key, person_id, display_name),
                )
                connection.execute(
                    "UPDATE invites SET use_count = use_count + 1, project_json = ?, revision = revision + 1 WHERE token_hash = ?",
                    (json.dumps(project, separators=(",", ":"), allow_nan=False), token_hash),
                )
                revision = row["revision"] + 1
            return {
                "project": project,
                "participant_id": person_id,
                "permission": row["permission"],
                "revision": revision,
                "expires_at": row["expires_at"],
            }

    def get_project(self, token: str) -> dict[str, Any]:
        token_hash = self._hash(token)
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM invites WHERE token_hash = ?", (token_hash,)).fetchone()
        if not row:
            raise InviteError("This invite link is invalid.")
        self._active(row)
        return {"project": json.loads(row["project_json"]), "permission": row["permission"], "revision": row["revision"]}

    def update_project(self, token: str, project: dict[str, Any], expected_revision: int) -> dict[str, Any]:
        token_hash = self._hash(token)
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT * FROM invites WHERE token_hash = ?", (token_hash,)).fetchone()
            if not row:
                raise InviteError("This invite link is invalid.")
            self._active(row)
            if row["permission"] != "edit":
                raise InviteError("This invite is view-only.")
            if row["revision"] != expected_revision:
                raise InviteConflictError("The shared room changed elsewhere. Reload it before publishing your edits.")
            revision = expected_revision + 1
            connection.execute(
                "UPDATE invites SET project_json = ?, project_name = ?, revision = ? WHERE token_hash = ?",
                (json.dumps(project, separators=(",", ":"), allow_nan=False), str(project["name"]), revision, token_hash),
            )
        return {"revision": revision}
