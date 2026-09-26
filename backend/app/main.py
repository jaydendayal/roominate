from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .openai_service import OpenAIService, OpenAIUnavailable, SpendGuardError
from .schemas import (
    ExplainProposalRequest,
    Explanation,
    ExplanationAIResult,
    ExtractedPrice,
    PaletteCandidate,
    ProductAIResult,
    ProductDimensions,
    RoomAIResult,
    RoomGeometryDraft,
    UrlImportRequest,
)
from .settings import get_settings
from .store import AIStore
from .url_reader import read_product_page

settings = get_settings()
store = AIStore(settings.database_path, settings.aggregate_guard_usd, settings.max_calls_per_project)
openai = OpenAIService(settings, store)

MAX_FILE_BYTES = 8_000_000
MAX_TOTAL_BYTES = 18_000_000
ALLOWED_IMAGES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_VIDEOS = {"video/mp4", "video/webm", "video/quicktime"}
PROMPT_VERSION = "2026-09-26.1"


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


app = FastAPI(title="Roominate AI service", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(SpendGuardError)
async def spend_guard_handler(_, exc: SpendGuardError) -> JSONResponse:
    return JSONResponse(status_code=402, content={"detail": str(exc), "code": "spend_guard"})


def _manual_room(confirmed: dict[str, Any], note: str) -> RoomAIResult:
    return RoomAIResult(
        schema_version="1.0",
        processing_status="partial",
        palette=[
            PaletteCandidate(hex="#E7DFD0", label="manual warm wall", confidence=0.0, evidence="Manual fallback; not inferred from media"),
            PaletteCandidate(hex="#A77F59", label="manual wood floor", confidence=0.0, evidence="Manual fallback; not inferred from media"),
            PaletteCandidate(hex="#7F9186", label="manual accent", confidence=0.0, evidence="Manual fallback; not inferred from media"),
        ],
        room=RoomGeometryDraft(
            width_m=confirmed.get("width_m"),
            length_m=confirmed.get("length_m"),
            height_m=confirmed.get("height_m"),
            notes=[note, "Confirmed measurements are preserved as the scale anchor."],
            features=[],
        ),
    )


def _video_frames(data: bytes, content_type: str) -> list[tuple[bytes, str]]:
    executable = shutil.which("ffmpeg")
    if not executable:
        return []
    suffix = ".webm" if content_type == "video/webm" else ".mov" if content_type == "video/quicktime" else ".mp4"
    with tempfile.TemporaryDirectory(prefix="roominate-frames-") as temp:
        root = Path(temp)
        source = root / f"walkthrough{suffix}"
        source.write_bytes(data)
        pattern = root / "frame-%02d.jpg"
        try:
            subprocess.run(
                [executable, "-hide_banner", "-loglevel", "error", "-i", str(source), "-vf", "fps=1/4,scale='min(1280,iw)':-2", "-frames:v", "3", str(pattern)],
                check=True,
                timeout=20,
                capture_output=True,
            )
        except (subprocess.SubprocessError, OSError):
            return []
        return [(path.read_bytes(), "image/jpeg") for path in sorted(root.glob("frame-*.jpg"))[:3]]


async def _read_media(files: list[UploadFile]) -> tuple[list[tuple[bytes, str]], list[str]]:
    images: list[tuple[bytes, str]] = []
    notes: list[str] = []
    total = 0
    for upload in files[:4]:
        content_type = (upload.content_type or "").lower()
        if content_type not in ALLOWED_IMAGES | ALLOWED_VIDEOS:
            raise HTTPException(status_code=415, detail=f"Unsupported media type: {content_type or 'unknown'}")
        data = await upload.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail="Each upload must be no larger than 8 MB.")
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="Selected media exceeds the 18 MB request limit.")
        if content_type in ALLOWED_IMAGES:
            images.append((data, content_type))
        else:
            frames = _video_frames(data, content_type)
            images.extend(frames)
            notes.append(f"Sampled {len(frames)} representative frames from {upload.filename or 'video'}." if frames else "Video retained, but server frame extraction is unavailable; upload still frames for AI analysis.")
    return images[:3], notes


def _room_response(result: RoomAIResult, status: str, message: str, usage: dict[str, int] | None = None) -> dict[str, Any]:
    return {**result.model_dump(), "status": status, "message": message, "usage": usage or {"input_tokens": 0, "output_tokens": 0}}


def _product_response(result: ProductAIResult, status: str, message: str, usage: dict[str, int] | None = None) -> dict[str, Any]:
    product = result.model_dump(exclude={"schema_version", "processing_status", "evidence", "uncertainties"})
    return {
        "schema_version": result.schema_version,
        "status": status,
        "message": message,
        "product": product,
        "evidence": result.evidence,
        "uncertainties": result.uncertainties,
        "usage": usage or {"input_tokens": 0, "output_tokens": 0},
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "openai_configured": openai.enabled, "model": settings.openai_model, "spend": store.stats()}


@app.post("/api/v1/analyze-room")
async def analyze_room(
    project_id: Annotated[str, Form(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")],
    confirmed_dimensions: Annotated[str, Form()],
    files: Annotated[list[UploadFile], File()] = [],
) -> dict[str, Any]:
    try:
        confirmed = json.loads(confirmed_dimensions)
        confirmed = {key: float(value) for key, value in confirmed.items() if key in {"width_m", "length_m", "height_m"} and value is not None}
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="confirmed_dimensions must be a JSON object of numeric meter values") from exc
    images, video_notes = await _read_media(files)
    cache_mode = f"{settings.openai_model}:{settings.image_detail}" if openai.enabled else "manual"
    cache_key = store.cache_key("room-analysis", PROMPT_VERSION, [cache_mode, json.dumps(confirmed, sort_keys=True)] + [data for data, _ in images])
    if cached := store.get_cached(cache_key):
        cached["status"] = "cached"
        return cached
    if not openai.enabled or not images:
        reason = "OPENAI_API_KEY is not configured." if not openai.enabled else "No analyzable image or video frames were supplied."
        result = _manual_room(confirmed, reason)
        response = _room_response(result, "manual_fallback", "Manual reconstruction is ready. " + " ".join(video_notes))
        store.put_cached(cache_key, "room-analysis", response)
        return response
    prompt = (
        "Analyze up to three selected room images or video frames. Propose only visible, reviewable structure and a small color palette. "
        "Confirmed dimensions are authoritative scale anchors; never replace them with image estimates. Hidden or occluded geometry must remain uncertain. "
        "Palette colors are approximate because lighting and cameras shift color. Evidence should identify the frame or visible region."
    )
    try:
        result, usage = await openai.structured_response(
            project_id=project_id,
            operation="room-analysis",
            system_prompt=prompt,
            user_text=f"Confirmed meter dimensions: {json.dumps(confirmed)}. Video processing notes: {' '.join(video_notes) or 'none'}.",
            result_type=RoomAIResult,
            images=images,
            max_output_tokens=900,
        )
        # Code, not the model, enforces confirmed scale values.
        result.room.width_m = confirmed.get("width_m", result.room.width_m)
        result.room.length_m = confirmed.get("length_m", result.room.length_m)
        result.room.height_m = confirmed.get("height_m", result.room.height_m)
        response = _room_response(result, "complete" if result.processing_status == "complete" else "partial", "Review every inferred feature before confirming it.", usage)
        store.put_cached(cache_key, "room-analysis", response)
        return response
    except SpendGuardError:
        raise
    except Exception as exc:
        result = _manual_room(confirmed, f"Model output was unavailable or invalid: {type(exc).__name__}.")
        return _room_response(result, "manual_fallback", "Analysis failed safely; the confirmed room remains editable.")


def _metadata_product(metadata: dict[str, object], source_url: str, note: str) -> ProductAIResult:
    amount_cents = None
    try:
        if metadata.get("price") is not None and str(metadata.get("currency", "USD")).upper() == "USD":
            amount_cents = round(float(str(metadata["price"]).replace(",", "")) * 100)
    except ValueError:
        amount_cents = None
    return ProductAIResult(
        schema_version="1.0",
        processing_status="partial",
        name=str(metadata["name"])[:240] if metadata.get("name") else None,
        store=str(metadata["store"])[:160] if metadata.get("store") else None,
        source_url=source_url,
        category=None,
        variant=None,
        dimensions=ProductDimensions(width_m=None, depth_m=None, height_m=None),
        price=ExtractedPrice(amount_cents=amount_cents, currency="USD", evidence="Structured page metadata", confidence=0.8) if amount_cents is not None else None,
        evidence=["Page metadata retained", note],
        uncertainties=["Dimensions require confirmation", "Displayed price may exclude shipping and tax"],
    )


@app.post("/api/v1/extract-product/url")
async def extract_product_url(request: UrlImportRequest) -> dict[str, Any]:
    raw_url = str(request.url)
    cache_mode = settings.openai_model if openai.enabled else "manual"
    cache_key = store.cache_key("product-url", PROMPT_VERSION, [cache_mode, raw_url])
    if cached := store.get_cached(cache_key):
        cached["status"] = "cached"
        return cached
    try:
        metadata, evidence = await read_product_page(raw_url)
    except Exception as exc:
        result = _metadata_product({}, raw_url, f"Source could not be read: {type(exc).__name__}")
        return _product_response(result, "manual_fallback", "The URL is retained. Enter only fields you can verify manually.")
    if not openai.enabled:
        result = _metadata_product(metadata, raw_url, "OPENAI_API_KEY is not configured")
        response = _product_response(result, "partial", "Page metadata was read without AI; missing facts remain unknown.")
        store.put_cached(cache_key, "product-url", response)
        return response
    try:
        result, usage = await openai.structured_response(
            project_id=request.project_id,
            operation="product-url",
            system_prompt=(
                "Extract only product facts explicitly supported by the supplied store-page evidence. Convert labeled dimensions to meters and a displayed USD price to integer cents. "
                "Use null for every missing or ambiguous field. Do not infer dimensions from a product image and do not claim a price is current beyond this observation."
            ),
            user_text=f"Source URL: {raw_url}\n{evidence}",
            result_type=ProductAIResult,
            max_output_tokens=750,
        )
        result.source_url = raw_url
        response = _product_response(result, result.processing_status, "Confirm extracted fields before adding the product.", usage)
        store.put_cached(cache_key, "product-url", response)
        return response
    except SpendGuardError:
        raise
    except Exception:
        result = _metadata_product(metadata, raw_url, "AI extraction was unavailable or invalid")
        return _product_response(result, "manual_fallback", "Page metadata was retained; confirm missing fields manually.")


@app.post("/api/v1/extract-product/screenshot")
async def extract_product_screenshot(
    project_id: Annotated[str, Form(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")],
    file: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_IMAGES:
        raise HTTPException(status_code=415, detail="Product screenshots must be JPEG, PNG, WebP, or GIF.")
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="The screenshot must be no larger than 8 MB.")
    cache_mode = f"{settings.openai_model}:{settings.image_detail}" if openai.enabled else "manual"
    cache_key = store.cache_key("product-screenshot", PROMPT_VERSION, [cache_mode, data])
    if cached := store.get_cached(cache_key):
        cached["status"] = "cached"
        return cached
    fallback = _metadata_product({}, "", "Screenshot retained for manual review")
    fallback.source_url = None
    if not openai.enabled:
        return _product_response(fallback, "manual_fallback", "OPENAI_API_KEY is not configured. Fill visible fields manually.")
    try:
        result, usage = await openai.structured_response(
            project_id=project_id,
            operation="product-screenshot",
            system_prompt=(
                "Extract only text and product facts visibly supported by this screenshot. Convert explicitly labeled dimensions to meters and a displayed USD price to integer cents. "
                "Use null for cropped, illegible, or absent values. A screenshot price is an observation, not a live price. Evidence should name the visible region."
            ),
            user_text="Extract a reviewable product draft from this screenshot.",
            result_type=ProductAIResult,
            images=[(data, content_type)],
            max_output_tokens=750,
        )
        response = _product_response(result, result.processing_status, "Confirm each visible field; missing dimensions remain unknown.", usage)
        store.put_cached(cache_key, "product-screenshot", response)
        return response
    except SpendGuardError:
        raise
    except Exception:
        return _product_response(fallback, "manual_fallback", "Screenshot extraction failed safely. Fill visible fields manually.")


@app.post("/api/v1/explain-proposal")
async def explain_proposal(request: ExplainProposalRequest) -> dict[str, Any]:
    cache_mode = settings.openai_model if openai.enabled else "manual"
    cache_key = store.cache_key("proposal-explanation", PROMPT_VERSION, [cache_mode, request.model_dump_json()])
    if cached := store.get_cached(cache_key):
        cached["status"] = "cached"
        return cached
    fallback = ExplanationAIResult(
        schema_version="1.0",
        processing_status="partial",
        explanations=[Explanation(change_id=change.change_id, explanation=f"{change.deterministic_reason} {change.deterministic_impact}") for change in request.changes],
    )
    if not openai.enabled or not request.changes:
        return {"status": "manual_fallback", **fallback.model_dump()}
    try:
        result, usage = await openai.structured_response(
            project_id=request.project_id,
            operation="proposal-explanation",
            system_prompt=(
                "Rewrite each already-validated cart change as one concise, friendly explanation. Preserve change IDs and every deterministic fact. "
                "Do not invent fit, price, policy, ownership, or reassignment claims. Mention the user's priorities only where directly relevant."
            ),
            user_text=request.model_dump_json(),
            result_type=ExplanationAIResult,
            max_output_tokens=600,
        )
        valid_ids = {change.change_id for change in request.changes}
        if {entry.change_id for entry in result.explanations} - valid_ids:
            raise ValueError("Explanation referenced an unknown change")
        response = {"status": result.processing_status, **result.model_dump(), "usage": usage}
        store.put_cached(cache_key, "proposal-explanation", response)
        return response
    except SpendGuardError:
        raise
    except Exception:
        return {"status": "manual_fallback", **fallback.model_dump()}
