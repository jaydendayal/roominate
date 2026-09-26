from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

import httpx

from .schemas import ShoppingListing, ShoppingSearchRequest
from .settings import Settings


class RetailerConfigurationError(RuntimeError):
    pass


def _nested(value: Any, *path: str) -> Any:
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _measurement(value: Any) -> float | None:
    if not isinstance(value, dict):
        return None
    try:
        number = float(value.get("displayValue"))
    except (TypeError, ValueError):
        return None
    unit = str(value.get("unit", "")).lower()
    factors = {"inches": 0.0254, "inch": 0.0254, "feet": 0.3048, "foot": 0.3048, "centimeters": 0.01, "centimeter": 0.01, "millimeters": 0.001, "millimeter": 0.001, "meters": 1.0, "meter": 1.0}
    factor = factors.get(unit)
    return round(number * factor, 4) if factor else None


def _first_listing_price(item: dict[str, Any]) -> int | None:
    listings = _nested(item, "offersV2", "listings")
    if not isinstance(listings, list) or not listings:
        return None
    price = _nested(listings[0], "price", "money", "amount")
    if price is None:
        price = _nested(listings[0], "price", "amount")
    try:
        return round(float(price) * 100)
    except (TypeError, ValueError):
        return None


class AmazonCreatorsClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._access_token: str | None = None
        self._token_expires_at = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.settings.amazon_credential_id and self.settings.amazon_credential_secret and self.settings.amazon_partner_tag)

    def _token_endpoint(self) -> str:
        version = self.settings.amazon_credential_version
        if version.startswith("3.2"):
            return "https://api.amazon.co.uk/auth/o2/token"
        if version.startswith("3.3"):
            return "https://api.amazon.co.jp/auth/o2/token"
        return "https://api.amazon.com/auth/o2/token"

    async def _token(self) -> str:
        if not self.configured:
            raise RetailerConfigurationError("Amazon discovery requires accepted Creators API credentials and an Associates partner tag.")
        if self._access_token and time.monotonic() < self._token_expires_at:
            return self._access_token
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(self._token_endpoint(), json={
                "grant_type": "client_credentials",
                "client_id": self.settings.amazon_credential_id,
                "client_secret": self.settings.amazon_credential_secret,
                "scope": "creatorsapi::default",
            })
        response.raise_for_status()
        payload = response.json()
        token = payload.get("access_token")
        if not isinstance(token, str):
            raise RetailerConfigurationError("Amazon did not return an OAuth access token.")
        self._access_token = token
        self._token_expires_at = time.monotonic() + max(60, int(payload.get("expires_in", 3600)) - 60)
        return token

    async def search(self, request: ShoppingSearchRequest) -> list[ShoppingListing]:
        token = await self._token()
        resources = ["images.primary.medium", "itemInfo.title", "itemInfo.classifications", "itemInfo.productInfo", "offersV2.listings.price", "offersV2.listings.availability"]
        body: dict[str, Any] = {
            "partnerTag": self.settings.amazon_partner_tag,
            "marketplace": self.settings.amazon_marketplace,
            "keywords": request.query,
            "searchIndex": "HomeAndKitchen",
            "itemCount": 10,
            "resources": resources,
            "currencyOfPreference": "USD",
        }
        if request.max_price_cents:
            body["maxPrice"] = request.max_price_cents
        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.post(
                "https://creatorsapi.amazon/catalog/v1/searchItems",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "x-marketplace": self.settings.amazon_marketplace},
                json=body,
            )
        response.raise_for_status()
        payload = response.json()
        items = _nested(payload, "searchResult", "items")
        if not isinstance(items, list):
            return []
        observed_at = datetime.now(UTC).isoformat()
        results: list[ShoppingListing] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            dimensions = _nested(item, "itemInfo", "productInfo", "itemDimensions") or {}
            width = _measurement(dimensions.get("width"))
            depth = _measurement(dimensions.get("length"))
            height = _measurement(dimensions.get("height"))
            name = _nested(item, "itemInfo", "title", "displayValue")
            url = item.get("detailPageURL")
            asin = item.get("asin")
            if not all(isinstance(value, str) and value for value in (name, url, asin)):
                continue
            category = _nested(item, "itemInfo", "classifications", "productGroup", "displayValue") or request.category or "home"
            image = _nested(item, "images", "primary", "medium", "url")
            complete = all(value is not None for value in (width, depth, height))
            results.append(ShoppingListing(
                provider="amazon", external_id=asin, name=name, source_url=url,
                image_url=image if isinstance(image, str) else None, category=str(category).lower(), variant="",
                width_m=width, depth_m=depth, height_m=height, price_cents=_first_listing_price(item), currency="USD",
                observed_at=observed_at, fit_status="dimensions_ready" if complete else "fit_unverified",
                evidence=["Amazon Creators API: itemInfo", "Amazon Creators API: OffersV2"],
            ))
        return results
