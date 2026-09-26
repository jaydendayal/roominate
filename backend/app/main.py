from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import httpx
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .openai_service import OpenAIService, OpenAIUnavailable, SpendGuardError
from .image_codec import ImageConversionError, heic_to_jpeg, is_heic
from .schemas import (
    ExplainProposalRequest,
    Explanation,
    ExplanationAIResult,
    ExtractedPrice,
    FurnitureVisualAIResult,
    FurnitureVisualProfile,
    PaletteCandidate,
    ProductAIResult,
    ProductDimensions,
    ProductVisualRequest,
    RoomAIResult,
    RoomGeometryDraft,
    UrlImportRequest,
    ShoppingSearchRequest,
    CreateInviteRequest,
    AcceptInviteRequest,
    UpdateInviteProjectRequest,
)
from .settings import get_settings
from .store import AIStore, InviteConflictError, InviteError, InviteStore
from .url_reader import read_product_page
from .shopping import AmazonCreatorsClient, RetailerConfigurationError

settings = get_settings()
store = AIStore(settings.database_path, settings.aggregate_guard_usd, settings.max_calls_per_project)
invite_store = InviteStore(settings.database_path)
openai = OpenAIService(settings, store)
amazon = AmazonCreatorsClient(settings)

MAX_FILE_BYTES = 8_000_000
MAX_TOTAL_BYTES = 18_000_000
ALLOWED_IMAGES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_HEIC = {"image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"}
ALLOWED_VIDEOS = {"video/mp4", "video/webm", "video/quicktime"}
PROMPT_VERSION = "2026-09-26.3-furniture-visual-profile"


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


app = FastAPI(title="Roominate AI service", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
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
        corners=[],
        surfaces=[],
        dimension_estimates=[
            {"dimension": key, "meters": confirmed.get(f"{key}_m"), "confidence": 1.0 if confirmed.get(f"{key}_m") else 0.0, "basis": "confirmed_reference" if confirmed.get(f"{key}_m") else "insufficient_evidence", "evidence": "User-confirmed scale reference." if confirmed.get(f"{key}_m") else "No analyzable media or scale evidence."}
            for key in ("width", "length", "height")
        ],
        uncertainties=["Room corners and surfaces require visual analysis."] if not confirmed else [],
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
        heic = is_heic(upload.filename, content_type)
        if content_type not in ALLOWED_IMAGES | ALLOWED_VIDEOS | ALLOWED_HEIC and not heic:
            raise HTTPException(status_code=415, detail=f"Unsupported media type: {content_type or 'unknown'}")
        data = await upload.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail="Each upload must be no larger than 8 MB.")
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="Selected media exceeds the 18 MB request limit.")
        if heic:
            try:
                images.append((heic_to_jpeg(data), "image/jpeg"))
                notes.append(f"Converted {upload.filename or 'HEIC image'} to JPEG for analysis.")
            except ImageConversionError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        elif content_type in ALLOWED_IMAGES:
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


def _safe_shared_project(project: dict[str, Any]) -> dict[str, Any]:
    """Validate the project envelope and remove browser-only private media."""
    try:
        cleaned = json.loads(json.dumps(project, allow_nan=False))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="The shared project must contain valid JSON values.") from exc
    required = {"schemaVersion", "id", "name", "ownerId", "people", "room", "products", "items"}
    if not required.issubset(cleaned) or cleaned.get("schemaVersion") != 1:
        raise HTTPException(status_code=422, detail="The shared project has an unsupported or incomplete schema.")
    if not isinstance(cleaned["name"], str) or not cleaned["name"].strip() or len(cleaned["name"]) > 160:
        raise HTTPException(status_code=422, detail="The shared project needs a valid name.")
    if not isinstance(cleaned["room"], dict) or not isinstance(cleaned["products"], list) or not isinstance(cleaned["people"], list):
        raise HTTPException(status_code=422, detail="The shared project structure is invalid.")
    # Links never carry room photos, video, screenshots, or a nested bearer token.
    cleaned["room"]["mediaAssets"] = []
    cleaned.pop("collaboration", None)
    for product in cleaned["products"]:
        if isinstance(product, dict):
            product.pop("screenshotDataUrl", None)
    if len(json.dumps(cleaned, separators=(",", ":")).encode()) > 750_000:
        raise HTTPException(status_code=413, detail="This project is too large to share as an invite snapshot.")
    return cleaned


def _invite_failure(exc: InviteError) -> HTTPException:
    return HTTPException(status_code=409 if isinstance(exc, InviteConflictError) else 410, detail=str(exc))


@app.post("/api/v1/invites")
async def create_invite(request: CreateInviteRequest) -> dict[str, Any]:
    project = _safe_shared_project(request.project)
    return invite_store.create(project, request.inviter_name, request.permission, request.expires_in_hours, request.max_uses)


@app.get("/api/v1/invites/{token}")
async def preview_invite(token: str) -> dict[str, Any]:
    if not 20 <= len(token) <= 100:
        raise HTTPException(status_code=404, detail="This invite link is invalid.")
    try:
        return invite_store.preview(token)
    except InviteError as exc:
        raise _invite_failure(exc) from exc


@app.post("/api/v1/invites/{token}/accept")
async def accept_invite(token: str, request: AcceptInviteRequest) -> dict[str, Any]:
    try:
        return invite_store.accept(token, request.display_name)
    except InviteError as exc:
        raise _invite_failure(exc) from exc


@app.get("/api/v1/invites/{token}/project")
async def get_invite_project(token: str) -> dict[str, Any]:
    try:
        return invite_store.get_project(token)
    except InviteError as exc:
        raise _invite_failure(exc) from exc


@app.put("/api/v1/invites/{token}/project")
async def update_invite_project(token: str, request: UpdateInviteProjectRequest) -> dict[str, Any]:
    try:
        return invite_store.update_project(token, _safe_shared_project(request.project), request.expected_revision)
    except InviteError as exc:
        raise _invite_failure(exc) from exc


def _fallback_visual_profile(name: str | None, category: str | None = None, note: str = "Deterministic name match") -> FurnitureVisualProfile:
    value = f"{category or ''} {name or ''}".lower().replace("_", "-")
    checks = (
        ("mini_fridge", ("mini fridge", "mini-fridge", "compact refrigerator")),
        ("hamper", ("laundry hamper", "hamper", "laundry basket")),
        ("beanbag", ("bean bag", "beanbag")),
        ("wardrobe", ("wardrobe", "armoire")),
        ("ottoman", ("ottoman", "footstool")),
        ("dresser", ("dresser", "chest of drawers")),
        ("couch", ("couch", "sofa", "loveseat")),
        ("chair", ("chair",)),
        ("desk", ("desk",)),
        ("lamp", ("floor lamp", "table lamp", "lamp", "lighting")),
        ("mirror", ("mirror",)),
    )
    archetype = next((kind for kind, terms in checks if any(term in value for term in terms)), "box")
    material = "fabric" if archetype in {"chair", "couch", "beanbag", "ottoman"} else "glass" if archetype == "mirror" else "metal" if archetype in {"lamp", "mini_fridge"} else "wood" if archetype in {"desk", "wardrobe", "dresser"} else "mixed"
    return FurnitureVisualProfile(
        archetype=archetype, style="utility", material=material, silhouette="standard",
        has_arms=archetype in {"chair", "couch"}, has_back=archetype in {"chair", "couch"},
        leg_style="four_leg" if archetype in {"chair", "couch", "desk"} else "solid" if archetype in {"wardrobe", "dresser", "mini_fridge"} else "none",
        color_hex=None, confidence=0.72 if archetype != "box" else 0.2, evidence=note,
    )


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "openai_configured": openai.enabled, "amazon_creators_configured": amazon.configured, "model": settings.openai_model, "spend": store.stats()}


@app.post("/api/v1/media/normalize-heic", response_class=Response)
async def normalize_heic(file: Annotated[UploadFile, File()]) -> Response:
    if not is_heic(file.filename, file.content_type):
        raise HTTPException(status_code=415, detail="This endpoint accepts HEIC or HEIF images only.")
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="The image must be no larger than 8 MB.")
    try:
        return Response(content=heic_to_jpeg(data), media_type="image/jpeg", headers={"Cache-Control": "no-store"})
    except ImageConversionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/v1/shopping/search")
async def search_shopping(request: ShoppingSearchRequest) -> dict[str, Any]:
    try:
        listings = await amazon.search(request)
        return {"provider": "amazon", "available": True, "message": "Amazon listings are current API observations. Confirm price and availability on Amazon.", "listings": [listing.model_dump() for listing in listings]}
    except RetailerConfigurationError as exc:
        return {"provider": "amazon", "available": False, "message": str(exc), "browse_url": "https://www.amazon.com/", "listings": []}
    except httpx.HTTPError:
        return {"provider": "amazon", "available": False, "message": "Amazon discovery is temporarily unavailable. Existing imports and retailer checkout still work.", "browse_url": "https://www.amazon.com/", "listings": []}


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
        "Analyze the ordered room frames as views of one room. Return only visible, reviewable structure and a small color palette. "
        "Detect strong wall-floor, wall-ceiling, wall-wall, and opening corners as normalized image coordinates where top-left is (0,0). "
        "Trace only clearly visible wall, floor, and ceiling polygons; do not invent points behind furniture or outside a frame. "
        "Use confirmed dimensions as authoritative scale anchors. Estimate another dimension only when image evidence plus an anchor makes it defensible; "
        "otherwise return null with insufficient_evidence. Never present monocular visual guesses as measurements. "
        "Report occlusion, lens distortion, unmatched views, and missing boundaries in uncertainties. Evidence must identify a 1-based frame number and visible region. "
        "Palette colors are approximate because lighting and cameras shift color."
    )
    try:
        result, usage = await openai.structured_response(
            project_id=project_id,
            operation="room-analysis",
            system_prompt=prompt,
            user_text=f"Confirmed meter dimensions: {json.dumps(confirmed)}. Video processing notes: {' '.join(video_notes) or 'none'}.",
            result_type=RoomAIResult,
            images=images,
            max_output_tokens=2200,
        )
        # Code, not the model, enforces confirmed scale values.
        result.room.width_m = confirmed.get("width_m", result.room.width_m)
        result.room.length_m = confirmed.get("length_m", result.room.length_m)
        result.room.height_m = confirmed.get("height_m", result.room.height_m)
        for estimate in result.dimension_estimates:
            confirmed_value = confirmed.get(f"{estimate.dimension}_m")
            if confirmed_value is not None:
                estimate.meters = confirmed_value
                estimate.confidence = 1.0
                estimate.basis = "confirmed_reference"
                estimate.evidence = "User-confirmed measurement supplied as the scale anchor."
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
        visual_profile=_fallback_visual_profile(str(metadata.get("name") or ""), None, note),
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
                "Use null for every missing or ambiguous field. Do not infer dimensions from a product image and do not claim a price is current beyond this observation. "
                "Also classify the named product into exactly one supported visual archetype and conservative style profile for procedural rendering. Visual fields never change dimensions."
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
    heic = is_heic(file.filename, content_type)
    if content_type not in ALLOWED_IMAGES | ALLOWED_HEIC and not heic:
        raise HTTPException(status_code=415, detail="Product screenshots must be HEIC, HEIF, JPEG, PNG, WebP, or GIF.")
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="The screenshot must be no larger than 8 MB.")
    if heic:
        try:
            data = heic_to_jpeg(data)
            content_type = "image/jpeg"
        except ImageConversionError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
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
                "Use null for cropped, illegible, or absent values. A screenshot price is an observation, not a live price. Evidence should name the visible region. "
                "Classify the visible product into exactly one supported visual archetype and conservative style profile. Use color_hex only when a product color is explicit or clearly visible. Visual fields never change dimensions."
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


@app.post("/api/v1/product-visual")
async def generate_product_visual(request: ProductVisualRequest) -> dict[str, Any]:
    fallback = FurnitureVisualAIResult(
        schema_version="1.0", processing_status="partial",
        visual_profile=_fallback_visual_profile(request.name, request.category, "Deterministic fallback from product name and category"),
    )
    cache_mode = settings.openai_model if openai.enabled else "manual"
    cache_key = store.cache_key("product-visual", PROMPT_VERSION, [cache_mode, request.name, request.category or "", request.variant or ""])
    if cached := store.get_cached(cache_key):
        cached["status"] = "cached"
        return cached
    if not openai.enabled:
        return {"status": "manual_fallback", "message": "OPENAI_API_KEY is not configured; a deterministic model was selected.", **fallback.model_dump()}
    try:
        result, usage = await openai.structured_response(
            project_id=request.project_id,
            operation="product-visual",
            system_prompt=(
                "Choose a conservative procedural furniture visual profile from the allowed enum values using only the product name, category, and variant. "
                "Do not generate code, geometry, dimensions, brands, or unsupported archetypes. Treat ambiguous names as box with low confidence. "
                "Choose color_hex only when the text explicitly names a color; otherwise return null. Evidence must briefly cite the name words that support the selection."
            ),
            user_text=f"Product name: {request.name}\nCategory: {request.category or 'unknown'}\nVariant: {request.variant or 'unknown'}",
            result_type=FurnitureVisualAIResult,
            max_output_tokens=450,
        )
        response = {"status": result.processing_status, "message": "Reviewable 3D style generated from the product name.", **result.model_dump(), "usage": usage}
        store.put_cached(cache_key, "product-visual", response)
        return response
    except SpendGuardError:
        raise
    except Exception:
        return {"status": "manual_fallback", "message": "AI styling was unavailable; a deterministic model was selected.", **fallback.model_dump()}


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
