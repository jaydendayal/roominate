from __future__ import annotations

import base64
import json
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel

from .settings import Settings
from .store import AIStore, SpendGuardError

T = TypeVar("T", bound=BaseModel)


class OpenAIUnavailable(RuntimeError):
    pass


def _schema_for(model_type: type[BaseModel]) -> dict[str, Any]:
    return model_type.model_json_schema()


def _output_text(response: dict[str, Any]) -> str:
    for item in response.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return content["text"]
    raise OpenAIUnavailable("The model returned no structured text output.")


class OpenAIService:
    def __init__(self, settings: Settings, store: AIStore) -> None:
        self.settings = settings
        self.store = store

    @property
    def enabled(self) -> bool:
        return bool(self.settings.openai_api_key)

    async def structured_response(
        self,
        *,
        project_id: str,
        operation: str,
        system_prompt: str,
        user_text: str,
        result_type: type[T],
        images: list[tuple[bytes, str]] | None = None,
        max_output_tokens: int = 900,
        image_detail: str | None = None,
    ) -> tuple[T, dict[str, int]]:
        if not self.settings.openai_api_key:
            raise OpenAIUnavailable("OPENAI_API_KEY is not configured.")
        request_id = self.store.reserve(project_id, operation, self.settings.max_estimated_call_usd)
        user_content: list[dict[str, Any]] = [{"type": "input_text", "text": user_text}]
        for data, mime_type in (images or [])[:3]:
            encoded = base64.b64encode(data).decode("ascii")
            user_content.append({"type": "input_image", "image_url": f"data:{mime_type};base64,{encoded}", "detail": image_detail or self.settings.image_detail})
        payload = {
            "model": self.settings.openai_model,
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                {"role": "user", "content": user_content},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": operation.replace("-", "_"),
                    "strict": True,
                    "schema": _schema_for(result_type),
                }
            },
            "max_output_tokens": max_output_tokens,
        }
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                response = await client.post(
                    "https://api.openai.com/v1/responses",
                    headers={"Authorization": f"Bearer {self.settings.openai_api_key}", "Content-Type": "application/json"},
                    json=payload,
                )
            if response.status_code >= 400:
                detail = response.json().get("error", {}).get("message", "OpenAI request failed")
                raise OpenAIUnavailable(str(detail))
            body = response.json()
            result = result_type.model_validate(json.loads(_output_text(body)))
            usage = body.get("usage") or {}
            input_tokens = int(usage.get("input_tokens") or 0)
            output_tokens = int(usage.get("output_tokens") or 0)
            actual = input_tokens / 1_000_000 * self.settings.input_cost_per_million + output_tokens / 1_000_000 * self.settings.output_cost_per_million
            self.store.finalize(request_id, actual, input_tokens, output_tokens)
            return result, {"input_tokens": input_tokens, "output_tokens": output_tokens}
        except (httpx.HTTPError, json.JSONDecodeError, ValueError, OpenAIUnavailable):
            self.store.fail(request_id)
            raise


__all__ = ["OpenAIService", "OpenAIUnavailable", "SpendGuardError"]
