from __future__ import annotations

import asyncio
import hashlib
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx

from .url_reader import validate_public_url


USER_AGENT = "RoominateDormResearch/1.0 (+https://roominate.local)"
MAX_HTML_BYTES = 1_000_000
MIN_CONTENT_CHARS = 500
_last_request_by_host: dict[str, float] = {}
_rate_lock = asyncio.Lock()
_robots_lock = asyncio.Lock()
_robots_cache: dict[str, tuple[float, RobotFileParser | None]] = {}
_robots_inflight: dict[str, asyncio.Task[RobotFileParser | None]] = {}
ROBOTS_CACHE_SECONDS = 3600


@dataclass(frozen=True)
class DormPage:
    source_url: str
    fetched_at: str
    raw_hash: str
    raw_html: str
    cleaned_text: str
    fetch_method: str


class ContentParser(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "button"}

    def __init__(self) -> None:
        super().__init__()
        self.depth = 0
        self.lines: list[str] = []
        self.current: list[str] = []
        self.prefix = ""

    def _flush(self) -> None:
        text = re.sub(r"\s+", " ", " ".join(self.current)).strip()
        if text:
            self.lines.append(f"{self.prefix}{text}")
        self.current = []
        self.prefix = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.SKIP:
            self.depth += 1
            return
        if self.depth:
            return
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "tr", "br"}:
            self._flush()
        if tag.startswith("h") and len(tag) == 2 and tag[1].isdigit():
            self.prefix = f"{'#' * min(int(tag[1]), 4)} "
        elif tag == "li":
            self.prefix = "- "

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP:
            self.depth = max(0, self.depth - 1)
            return
        if not self.depth and tag in {"h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "tr"}:
            self._flush()

    def handle_data(self, data: str) -> None:
        if not self.depth and data.strip():
            self.current.append(data)

    def text(self) -> str:
        self._flush()
        deduped: list[str] = []
        for line in self.lines:
            if len(line) < 2 or (deduped and line == deduped[-1]):
                continue
            deduped.append(line)
        return "\n".join(deduped)


async def _rate_limit(host: str) -> None:
    async with _rate_lock:
        now = time.monotonic()
        scheduled = max(now, _last_request_by_host.get(host, 0) + 0.75)
        _last_request_by_host[host] = scheduled
    # Sleep outside the global lock: unrelated university hosts can proceed concurrently while
    # requests to the same host remain spaced out.
    if scheduled > now:
        await asyncio.sleep(scheduled - now)


async def _load_robots(client: httpx.AsyncClient, robots_url: str) -> RobotFileParser | None:
    try:
        response = await client.get(robots_url)
        if response.status_code >= 400:
            return None
        parser = RobotFileParser(robots_url)
        parser.parse(response.text.splitlines())
        return parser
    except httpx.HTTPError:
        return None


async def _robots_allowed(client: httpx.AsyncClient, url: str) -> bool:
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    now = time.monotonic()
    async with _robots_lock:
        cached = _robots_cache.get(origin)
        if cached and cached[0] > now:
            parser = cached[1]
            return parser is None or parser.can_fetch(USER_AGENT, url)
        task = _robots_inflight.get(origin)
        if task is None:
            task = asyncio.create_task(_load_robots(client, f"{origin}/robots.txt"))
            _robots_inflight[origin] = task
    try:
        parser = await task
    finally:
        async with _robots_lock:
            if _robots_inflight.get(origin) is task:
                _robots_inflight.pop(origin, None)
    async with _robots_lock:
        _robots_cache[origin] = (time.monotonic() + ROBOTS_CACHE_SECONDS, parser)
    return parser is None or parser.can_fetch(USER_AGENT, url)


def clean_html(html: str) -> str:
    parser = ContentParser()
    parser.feed(html)
    return parser.text()


def section_chunks(text: str, max_chars: int = 12_000) -> list[str]:
    sections = re.split(r"(?=^#{1,4} )", text, flags=re.MULTILINE)
    chunks: list[str] = []
    current = ""
    for section in sections:
        if len(current) + len(section) + 1 > max_chars and current:
            chunks.append(current.strip())
            current = ""
        if len(section) > max_chars:
            chunks.extend(section[index:index + max_chars] for index in range(0, len(section), max_chars))
        else:
            current += f"\n{section}"
    if current.strip():
        chunks.append(current.strip())
    return chunks


async def _browser_html(url: str) -> str | None:
    node = shutil.which("node")
    script = str(Path(__file__).resolve().parents[2] / "scripts" / "render-page.mjs")
    if not node:
        return None
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            [node, script, url],
            check=True,
            capture_output=True,
            timeout=20,
        )
        return completed.stdout.decode("utf-8", errors="replace")[:MAX_HTML_BYTES]
    except (OSError, subprocess.SubprocessError):
        return None


async def fetch_dorm_page(raw_url: str, browser_fallback: bool = False) -> DormPage:
    url = validate_public_url(raw_url)
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}
    async with httpx.AsyncClient(timeout=12, follow_redirects=False, headers=headers) as client:
        if not await _robots_allowed(client, url):
            raise ValueError("The site robots.txt does not permit Roominate to fetch this page.")
        for _ in range(4):
            await _rate_limit(urlparse(url).hostname or "")
            response = await client.get(url)
            if response.status_code not in {301, 302, 303, 307, 308}:
                break
            location = response.headers.get("location")
            if not location:
                raise ValueError("The page returned an invalid redirect.")
            url = validate_public_url(urljoin(url, location))
        else:
            raise ValueError("The page redirected too many times.")
        response.raise_for_status()
        if "text/html" not in response.headers.get("content-type", ""):
            raise ValueError("The source did not return an HTML page.")
        raw = response.content[:MAX_HTML_BYTES]
    text = clean_html(raw.decode(response.encoding or "utf-8", errors="replace"))
    fetch_method = "http"
    if len(text) < MIN_CONTENT_CHARS and browser_fallback:
        rendered = await _browser_html(url)
        if rendered:
            raw = rendered.encode()
            text = clean_html(rendered)
            fetch_method = "playwright"
    if len(text) < MIN_CONTENT_CHARS:
        raise ValueError("The page exposed too little readable content; use a more specific public housing page.")
    return DormPage(
        source_url=url,
        fetched_at=response.headers.get("date", ""),
        raw_hash=hashlib.sha256(raw).hexdigest(),
        raw_html=raw.decode("utf-8", errors="replace"),
        cleaned_text=text,
        fetch_method=fetch_method,
    )


__all__ = ["DormPage", "clean_html", "fetch_dorm_page", "section_chunks"]
