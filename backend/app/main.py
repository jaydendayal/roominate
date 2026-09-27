from __future__ import annotations

import json
import httpx
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import urlparse

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from pydantic import TypeAdapter, ValidationError

from .openai_service import OpenAIService, OpenAIUnavailable, SpendGuardError
from .image_codec import ImageConversionError, heic_to_jpeg, is_heic
from .plan_reader import reviewed_plan_reading
from .schemas import (
    ExplainProposalRequest,
    Explanation,
    ExplanationAIResult,
    ExtractedPrice,
    FloorPlanAIResult,
    FurnitureVisualAIResult,
    FurnitureVisualProfile,
    ProductAIResult,
    ProductDimensions,
    ProductVisualRequest,
    TracedWall,
    UrlImportRequest,
    ShoppingSearchRequest,
    CreateInviteRequest,
    AcceptInviteRequest,
    UpdateInviteProjectRequest,
    DormResearchAIResult,
    DormResearchRequest,
    LayoutRecommendationAIResult,
    RecommendLayoutRequest,
)
from .settings import get_settings
from .store import AIStore, InviteConflictError, InviteError, InviteStore
from .url_reader import read_product_page
from .shopping import AmazonCreatorsClient, RetailerConfigurationError
from .dorm_reader import fetch_dorm_page, section_chunks

settings = get_settings()
store = AIStore(settings.database_path, settings.aggregate_guard_usd, settings.max_calls_per_project)
invite_store = InviteStore(settings.database_path)
openai = OpenAIService(settings, store)
amazon = AmazonCreatorsClient(settings)

MAX_FILE_BYTES = 8_000_000
MAX_TOTAL_BYTES = 18_000_000
ALLOWED_IMAGES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_HEIC = {"image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"}
PROMPT_VERSION = "2026-09-26.6-parametric-product-parts"
DORM_PROMPT_VERSION = "2026-09-26.2-room-type-matching"
DORM_SEARCH_VERSION = "2026-09-26.2-room-type-search"


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


app = FastAPI(title="Roominate AI service", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(SpendGuardError)
async def spend_guard_handler(_, exc: SpendGuardError) -> JSONResponse:
    return JSONResponse(status_code=402, content={"detail": str(exc), "code": "spend_guard"})


async def _read_media(files: list[UploadFile]) -> tuple[list[tuple[bytes, str]], list[str]]:
    images: list[tuple[bytes, str]] = []
    notes: list[str] = []
    total = 0
    for upload in files[:4]:
        content_type = (upload.content_type or "").lower()
        heic = is_heic(upload.filename, content_type)
        if content_type not in ALLOWED_IMAGES | ALLOWED_HEIC and not heic:
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
        else:
            images.append((data, content_type))
    return images[:3], notes


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
    """Validate the project envelope and remove browser-only product screenshots."""
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
    # Links never carry product screenshots or a nested bearer token.
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
        parts=[],
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


_TRACED_WALLS = TypeAdapter(list[TracedWall])


def _plan_response(reading: dict[str, Any], status: str, message: str, usage: dict[str, int] | None = None) -> dict[str, Any]:
    return {**reading, "status": status, "message": message, "usage": usage or {"input_tokens": 0, "output_tokens": 0}}


def _empty_plan_reading(note: str) -> dict[str, Any]:
    return {"schema_version": "1.0", "processing_status": "partial", "dimensions": [], "openings": [], "uncertainties": [note]}


@app.post("/api/v1/read-floor-plan")
async def read_floor_plan(
    project_id: Annotated[str, Form(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")],
    walls: Annotated[str, Form(max_length=8000)],
    files: Annotated[list[UploadFile], File()] = [],
) -> dict[str, Any]:
    """Reads printed dimensions and openings for one traced room. The browser traces the outline itself;
    this only reads labels, and code (not the model) turns printed text into meters."""
    try:
        traced = _TRACED_WALLS.validate_json(walls)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="walls must be a JSON list of lettered wall segments in image fractions") from exc
    if not 3 <= len(traced) <= 64 or len({wall.label for wall in traced}) != len(traced):
        raise HTTPException(status_code=422, detail="walls must list 3 to 64 uniquely lettered walls")
    images, _ = await _read_media(files)
    if not images:
        raise HTTPException(status_code=422, detail="Upload the floor plan image to read it.")
    walls_json = json.dumps([wall.model_dump() for wall in traced], sort_keys=True)
    cache_mode = f"{settings.openai_model}:high" if openai.enabled else "manual"
    cache_key = store.cache_key("floor-plan", PROMPT_VERSION, [cache_mode, walls_json] + [data for data, _ in images])
    if cached := store.get_cached(cache_key):
        cached["status"] = "cached"
        return cached
    if not openai.enabled:
        return _plan_response(_empty_plan_reading("Printed dimensions were not read."), "manual_fallback", "OPENAI_API_KEY is not configured, so printed dimensions can't be read. Enter a wall length you know instead.")
    prompt = (
        "You read architectural floor plans. Image 1 is a floor plan. Image 2 is the same plan with one room's traced outline drawn in magenta "
        "and its walls lettered (A, B, C, ...) in boxes just outside the outline. Report only what is printed or drawn on the plan for that outlined room. "
        "dimensions: each printed dimension string that measures the outlined room. Copy the text exactly as printed, such as 12'-6\" or 3.81 m, and split a "
        "combined label such as 11'-8\" x 13'-2\" into two entries. Set spans to wall with that wall's letter when it measures one lettered wall, "
        "overall_width when it is the room's full left-to-right extent in the image, overall_length for the full top-to-bottom extent, and other for anything else. "
        "Never compute, convert, scale, or estimate a length, and never report a dimension that is not printed. "
        "openings: doors (a gap in the wall with a swing arc or leaf), windows (thin parallel lines within a wall), closets, radiators, and fixed obstacles "
        "belonging to the outlined room. position is the opening's center as fractions of the image width and height, with the top-left at 0,0. "
        "wall_label is the lettered wall it sits in, or null for an interior item. width_ratio is the share of that wall the opening spans when the drawing shows it, else null. "
        "uncertainties: illegible text, missing scale, or anything ambiguous. Use empty lists when nothing qualifies. Evidence names the visible region or label."
    )
    wall_list = "; ".join(f"{wall.label} ({wall.start.x:.3f}, {wall.start.y:.3f}) to ({wall.end.x:.3f}, {wall.end.y:.3f})" for wall in traced)
    try:
        result, usage = await openai.structured_response(
            project_id=project_id,
            operation="floor-plan",
            system_prompt=prompt,
            user_text=f"Lettered walls of the traced room, as image fractions (x right, y down): {wall_list}.",
            result_type=FloorPlanAIResult,
            images=images[:2],
            max_output_tokens=1400,
            # Dimension labels are small print; low detail can't resolve them.
            image_detail="high",
        )
        reading = reviewed_plan_reading(result, traced)
        message = "Choose which printed dimensions to use. Doors and windows are added unconfirmed." if reading["dimensions"] or reading["openings"] else "No printed dimensions or openings were found for this room. Enter a wall length you know instead."
        response = _plan_response(reading, "complete" if result.processing_status == "complete" else "partial", message, usage)
        store.put_cached(cache_key, "floor-plan", response)
        return response
    except SpendGuardError:
        raise
    except Exception as exc:
        return _plan_response(_empty_plan_reading(f"Model output was unavailable or invalid: {type(exc).__name__}."), "manual_fallback", "The plan couldn't be read automatically. Enter a wall length you know instead.")


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


@app.post("/api/v1/research-dorm")
async def research_dorm(request: DormResearchRequest) -> dict[str, Any]:
    discovered_sources: list[dict[str, str]] = []
    requested_urls = [str(url) for url in request.urls]
    if not requested_urls:
        if not openai.enabled:
            raise HTTPException(status_code=503, detail="OPENAI_API_KEY is required to search for official dorm sources.")
        search_cache_key = store.cache_key(
            "dorm-source-search",
            DORM_SEARCH_VERSION,
            [settings.openai_model, request.college.casefold(), request.residence_hall.casefold(), (request.room_type or "").casefold()],
        )
        cached_search = store.get_cached(search_cache_key)
        if cached_search:
            search_sources = cached_search.get("sources", [])
        else:
            search_sources, _ = await openai.discover_dorm_sources(
                project_id=request.project_id,
                college=request.college,
                residence_hall=request.residence_hall,
                room_type=request.room_type,
            )
            store.put_cached(search_cache_key, "dorm-source-search", {"sources": search_sources})
        blocked = {"reddit.com", "wikipedia.org", "facebook.com", "instagram.com", "youtube.com", "tiktok.com", "apartments.com"}
        hall_tokens = [token for token in f"{request.residence_hall} {request.room_type or ''}".lower().split() if len(token) > 2]
        scored: list[tuple[int, dict[str, str]]] = []
        for source in search_sources:
            try:
                parsed = urlparse(source["url"])
                host = (parsed.hostname or "").lower()
                if parsed.scheme != "https" or any(host == domain or host.endswith(f".{domain}") for domain in blocked):
                    continue
                academic = host.endswith(".edu") or ".edu." in host or ".ac." in host
                haystack = f"{source.get('title', '')} {source['url']}".lower()
                hall_score = sum(token in haystack for token in hall_tokens)
                relevance = sum(term in haystack for term in ("housing", "residence", "dorm", "room", "floor", "furniture"))
                if not academic and hall_score == 0:
                    continue
                scored.append((10 * int(academic) + 3 * hall_score + relevance, source))
            except (KeyError, ValueError):
                continue
        discovered_sources = [source for _, source in sorted(scored, key=lambda item: item[0], reverse=True)[:3]]
        requested_urls = [source["url"] for source in discovered_sources]

    pages: list[dict[str, str]] = []
    failures: list[dict[str, str]] = []
    for raw_url in requested_urls:
        try:
            page = await fetch_dorm_page(raw_url, browser_fallback=settings.dorm_browser_fallback_enabled)
            store.put_web_page(page.source_url, page.raw_hash, page.raw_html, page.cleaned_text, page.fetch_method)
            pages.append({
                "source_url": page.source_url,
                "raw_hash": page.raw_hash,
                "fetched_at": page.fetched_at,
                "fetch_method": page.fetch_method,
                "cleaned_text": page.cleaned_text,
            })
        except Exception as exc:
            failures.append({"source_url": raw_url, "error": str(exc)[:240]})
    if not pages:
        return {
            "schema_version": "1.0", "processing_status": "partial", "status": "partial",
            "college": request.college, "residence_hall": request.residence_hall, "room_type": None,
            "room_width_m": None, "room_length_m": None, "room_height_m": None, "room_confidence": 0,
            "room_evidence": [], "items": [], "uncertainties": ["No useful official housing page could be fetched automatically."],
            "sources": [], "discovered_sources": discovered_sources, "failures": failures, "needs_manual_sources": True,
            "usage": {"input_tokens": 0, "output_tokens": 0},
            "message": "Automatic search did not produce readable dimension sources. Add one or more official housing links.",
        }

    cache_mode = settings.openai_model if openai.enabled else "manual"
    page_signature = json.dumps([(page["source_url"], page["raw_hash"]) for page in pages], sort_keys=True)
    cache_key = store.cache_key("dorm-research", DORM_PROMPT_VERSION, [cache_mode, request.college, request.residence_hall or "", request.room_type or "", page_signature])
    if cached := store.get_cached(cache_key):
        cached["status"] = "cached"
        cached["failures"] = failures
        cached["discovered_sources"] = discovered_sources
        return cached
    if not openai.enabled:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is required for dorm dimension extraction.")

    keywords = ("dimension", "width", "length", "height", "desk", "bed", "dresser", "wardrobe", "furniture", "room", "mattress", "floor plan")
    evidence_blocks: list[str] = []
    for page in pages:
        chunks = section_chunks(page["cleaned_text"])
        ranked = sorted(chunks, key=lambda chunk: sum(chunk.lower().count(keyword) for keyword in keywords), reverse=True)
        selected = ranked[:3] or chunks[:1]
        evidence_blocks.append(f"SOURCE URL: {page['source_url']}\n" + "\n\n".join(selected))
    evidence = "\n\n--- NEXT SOURCE ---\n\n".join(evidence_blocks)[:32_000]
    prompt = (
        "Extract dorm-room and included-furniture dimensions only when explicitly supported by the supplied university housing pages. "
        "Convert labeled measurements to meters. Never estimate a missing dimension, never treat a generic university standard as specific to a named hall, and use null when evidence is absent or ambiguous. "
        "Every non-null dimension must have short evidence containing the exact source URL and a concise quote from that source. "
        "A dimension order such as 36 x 80 inches must only be mapped to width/depth/height when the page labels or context makes the axes clear. "
        "Mark furniture included_with_room only when the page says it is provided. Preserve uncertainty about room types and building variations. "
        "When a room type was requested, do not mix dimensions from single, double, triple, suite, or apartment designs; return null rather than using a different design."
    )
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            result, usage = await openai.structured_response(
                project_id=request.project_id,
                operation=f"dorm-research-{attempt + 1}",
                system_prompt=prompt + (" The prior extraction failed schema validation; return a corrected schema-conformant result." if attempt else ""),
                user_text=f"College: {request.college}\nResidence hall: {request.residence_hall or 'not specified'}\nRequested room type: {request.room_type or 'not specified'}\n\n{evidence}",
                result_type=DormResearchAIResult,
                max_output_tokens=1800,
            )
            response = {
                **result.model_dump(),
                "status": result.processing_status,
                "sources": [{key: page[key] for key in ("source_url", "raw_hash", "fetched_at", "fetch_method")} for page in pages],
                "failures": failures,
                "discovered_sources": discovered_sources,
                "needs_manual_sources": not any((result.room_width_m, result.room_length_m, result.room_height_m)) and not any(any((item.width_m, item.depth_m, item.height_m)) for item in result.items),
                "usage": usage,
                "message": "Review and confirm every extracted measurement before using it for fit decisions.",
            }
            if response["needs_manual_sources"]:
                response["message"] = "The automatic search found pages, but no useful dimensions. Add an official housing or furniture link."
            store.put_cached(cache_key, "dorm-research", response)
            return response
        except SpendGuardError:
            raise
        except Exception as exc:
            last_error = exc
    raise HTTPException(status_code=502, detail=f"Dorm pages were fetched, but structured extraction failed: {type(last_error).__name__}")


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
                "Also classify the named product into exactly one supported visual archetype and conservative style profile for procedural rendering. "
                "Only provide parametric parts when the page evidence clearly describes visible structure; otherwise return an empty parts list. Visual fields never change dimensions."
            ),
            user_text=f"Source URL: {raw_url}\n{evidence}",
            result_type=ProductAIResult,
            max_output_tokens=1200,
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
                "Treat the image as a product photo or shopping screenshot and identify the single dominant furniture or room product. "
                "Extract only text and product facts visibly supported by the image. Convert explicitly labeled dimensions to meters and a displayed USD price to integer cents. "
                "Use null for cropped, illegible, or absent values. A screenshot price is an observation, not a live price. Evidence should name the visible region. "
                "Classify the product's visible silhouette, material, arms, back, legs, and color into exactly one supported procedural visual profile. "
                "Build a simplified parametric likeness from 4 to 20 clearly visible major parts. Use X for left/right width, Y for vertical height, and Z for front/back depth. "
                "For each part, position is its normalized center from -0.5 to 0.5 and size is its fraction of the confirmed collision width, height, and depth. "
                "Keep every part inside that normalized box, use degrees for rotation, preserve obvious symmetry, and omit tiny hardware or details hidden by the view. "
                "Use color_hex only when a part color is explicit or clearly visible. Parts approximate appearance only: they never change dimensions or collision bounds and must not imply photogrammetric reconstruction."
            ),
            user_text="Extract a reviewable product draft and a procedural 3D appearance from this image.",
            result_type=ProductAIResult,
            images=[(data, content_type)],
            max_output_tokens=1800,
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
                "When those words describe structure clearly, assemble a simplified likeness from 4 to 20 safe parametric parts; otherwise return an empty parts list and use the archetype fallback. "
                "Use X for left/right width, Y for vertical height, and Z for front/back depth. Part positions are normalized centers from -0.5 to 0.5; sizes are fractions of the collision width, height, and depth. "
                "Keep every part inside the normalized box, express rotations in degrees, and preserve obvious symmetry. Do not output code, dimensions, brands, unsupported primitives, or tiny decorative hardware. "
                "Choose color_hex only when text explicitly names a color; otherwise return null. Evidence must briefly cite the words supporting the structure."
            ),
            user_text=f"Product name: {request.name}\nCategory: {request.category or 'unknown'}\nVariant: {request.variant or 'unknown'}",
            result_type=FurnitureVisualAIResult,
            max_output_tokens=1500,
        )
        response = {"status": result.processing_status, "message": "Reviewable 3D style generated from the product name.", **result.model_dump(), "usage": usage}
        store.put_cached(cache_key, "product-visual", response)
        return response
    except SpendGuardError:
        raise
    except Exception:
        return {"status": "manual_fallback", "message": "AI styling was unavailable; a deterministic model was selected.", **fallback.model_dump()}


@app.post("/api/v1/recommend-layout")
async def recommend_layout(request: RecommendLayoutRequest) -> dict[str, Any]:
    """Lets AI choose among layouts that have already passed deterministic collision checks."""
    fallback = request.candidates[0]
    fallback_response = {
        "schema_version": "1.0",
        "processing_status": "partial",
        "candidate_id": fallback.candidate_id,
        "rationale": "Selected the balanced collision-tested layout. Review it and lock anything that should not move.",
    }
    if len(request.candidates) == 1 or not openai.enabled:
        return {"status": "manual_fallback", **fallback_response, "usage": {"input_tokens": 0, "output_tokens": 0}}
    cache_key = store.cache_key("layout-recommendation", PROMPT_VERSION, [settings.openai_model, request.model_dump_json()])
    if cached := store.get_cached(cache_key):
        cached["status"] = "cached"
        return cached
    try:
        result, usage = await openai.structured_response(
            project_id=request.project_id,
            operation="layout-recommendation",
            system_prompt=(
                "Choose exactly one of the supplied whole-room furniture layouts. Every candidate has already passed code-based wall, collision, ceiling, and clearance checks; do not recalculate or alter coordinates. "
                "Prefer a practical dorm arrangement: preserve a clear center and entry path, keep large storage on perimeter walls, put desks near windows when possible, and keep chairs, lamps, hampers, and ottomans near the furniture they support. "
                "Use the room type and user priorities as tie-breakers. Return only a supplied candidate_id and a concise rationale; never invent another layout."
            ),
            user_text=request.model_dump_json(),
            result_type=LayoutRecommendationAIResult,
            max_output_tokens=260,
        )
        valid_ids = {candidate.candidate_id for candidate in request.candidates}
        if result.candidate_id not in valid_ids:
            raise ValueError("Layout recommendation referenced an unknown candidate")
        response = {"status": result.processing_status, **result.model_dump(), "usage": usage}
        store.put_cached(cache_key, "layout-recommendation", response)
        return response
    except SpendGuardError:
        raise
    except Exception:
        return {"status": "manual_fallback", **fallback_response, "usage": {"input_tokens": 0, "output_tokens": 0}}


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
