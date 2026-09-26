from __future__ import annotations

import ipaddress
import json
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx


class MetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.meta: dict[str, str] = {}
        self.json_ld: list[dict] = []
        self._in_title = False
        self._json_ld = False
        self._json_chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "title":
            self._in_title = True
        if tag == "meta":
            key = values.get("property") or values.get("name")
            value = values.get("content")
            if key and value:
                self.meta[key.lower()] = value.strip()
        if tag == "script" and values.get("type", "").lower() == "application/ld+json":
            self._json_ld = True
            self._json_chunks = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag == "script" and self._json_ld:
            self._json_ld = False
            try:
                parsed = json.loads("".join(self._json_chunks))
                values = parsed if isinstance(parsed, list) else [parsed]
                self.json_ld.extend(item for item in values if isinstance(item, dict))
            except (json.JSONDecodeError, TypeError):
                pass

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._json_ld:
            self._json_chunks.append(data)


def validate_public_url(raw_url: str) -> str:
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only public HTTP(S) product URLs are accepted.")
    if parsed.username or parsed.password:
        raise ValueError("URLs containing credentials are not accepted.")
    if parsed.hostname.lower() in {"localhost", "localhost.localdomain"}:
        raise ValueError("Local network URLs are not accepted.")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise ValueError("The product host could not be resolved.") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError("Private or reserved network destinations are not accepted.")
    return raw_url


async def read_product_page(raw_url: str) -> tuple[dict[str, object], str]:
    url = validate_public_url(raw_url)
    async with httpx.AsyncClient(follow_redirects=False, timeout=8.0, headers={"User-Agent": "RoominateProductImporter/0.1"}) as client:
        response = await client.get(url)
        if response.status_code in {301, 302, 303, 307, 308}:
            location = response.headers.get("location")
            if not location:
                raise ValueError("The store returned an invalid redirect.")
            next_url = str(httpx.URL(url).join(location))
            validate_public_url(next_url)
            response = await client.get(next_url)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type:
            raise ValueError("The product URL did not return an HTML page.")
        html = response.text[:750_000]
    parser = MetadataParser()
    parser.feed(html)
    product_ld = next((item for item in parser.json_ld if str(item.get("@type", "")).lower() == "product"), {})
    offers = product_ld.get("offers", {}) if isinstance(product_ld.get("offers"), dict) else {}
    description = str(product_ld.get("description") or parser.meta.get("og:description") or "")
    clean_text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))[:14_000]
    metadata = {
        "name": product_ld.get("name") or parser.meta.get("og:title") or parser.title.strip() or None,
        "store": urlparse(url).hostname,
        "price": offers.get("price"),
        "currency": offers.get("priceCurrency"),
        "description": description[:3_000],
    }
    evidence = json.dumps(metadata, ensure_ascii=False) + "\nVisible page excerpt:\n" + clean_text
    return metadata, evidence

