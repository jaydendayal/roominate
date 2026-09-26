from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    openai_api_key: str | None
    openai_model: str
    image_detail: str
    aggregate_guard_usd: float
    max_calls_per_project: int
    max_estimated_call_usd: float
    input_cost_per_million: float
    output_cost_per_million: float
    database_path: Path
    allowed_origins: tuple[str, ...]
    amazon_credential_id: str | None
    amazon_credential_secret: str | None
    amazon_credential_version: str
    amazon_partner_tag: str | None
    amazon_marketplace: str


def get_settings() -> Settings:
    backend_root = Path(__file__).resolve().parents[1]
    raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    return Settings(
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        image_detail=os.getenv("OPENAI_IMAGE_DETAIL", "low"),
        # The product has $10 total credits; $9 is callable and $1 stays reserved.
        aggregate_guard_usd=min(_float("OPENAI_AGGREGATE_SPEND_GUARD_USD", 9.0), 10.0),
        max_calls_per_project=max(1, _int("OPENAI_MAX_CALLS_PER_PROJECT", 6)),
        max_estimated_call_usd=max(0.01, _float("OPENAI_MAX_ESTIMATED_CALL_USD", 0.08)),
        # Current GPT-4.1 mini standard rates as documented when this project was built.
        # Override these whenever OPENAI_MODEL changes.
        input_cost_per_million=max(0.0, _float("OPENAI_INPUT_COST_PER_1M", 0.40)),
        output_cost_per_million=max(0.0, _float("OPENAI_OUTPUT_COST_PER_1M", 1.60)),
        database_path=Path(os.getenv("ROOMINATE_AI_DB", str(backend_root / "data" / "ai_cache.sqlite"))),
        allowed_origins=tuple(origin.strip() for origin in raw_origins.split(",") if origin.strip()),
        amazon_credential_id=os.getenv("AMAZON_CREATORS_CREDENTIAL_ID") or None,
        amazon_credential_secret=os.getenv("AMAZON_CREATORS_CREDENTIAL_SECRET") or None,
        amazon_credential_version=os.getenv("AMAZON_CREATORS_CREDENTIAL_VERSION", "3.1"),
        amazon_partner_tag=os.getenv("AMAZON_ASSOCIATE_PARTNER_TAG") or None,
        amazon_marketplace=os.getenv("AMAZON_MARKETPLACE", "www.amazon.com"),
    )
