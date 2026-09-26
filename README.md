# Roominate

Roominate is a responsive, shared-room planning app for answering a practical question: does the group cart fit the room, budget, roommate inventory, housing rules, and actual needs?

The repository is a working vertical slice built from the supplied PRD:

- Next.js + TypeScript responsive frontend
- React Three Fiber room editor in real-world meter units
- FastAPI service for server-only OpenAI Responses API calls
- deterministic collision, clearance, duplicate, rule, and budget checks
- local development persistence with a resettable full-flow demo
- browser-based guided room capture with six viewpoints, quality feedback, and a measured scale reference
- dimension-scaled procedural 3D models for chairs, couches, desks, wardrobes, hampers, beanbags, ottomans, dressers, lamps, mirrors, and mini fridges
- schema-constrained OpenAI visual profiles that map product names to safe procedural archetypes and style variants
- collision-tested Better Cart actions with individual accept/reject and undo
- optional Amazon Creators API discovery with deterministic room-fit screening
- retailer-grouped cart handoff without collecting payment details
- expiring remote roommate invites with view/edit permissions, private-media stripping, collaborator identity matching, and revision-safe explicit publishing

Room geometry uses a single right-handed convention throughout the domain model, fit engine, and renderer: **X** is room width, **Y** is room length, and **Z** is vertical height. Furniture positions therefore live on the `(x, y)` floor plane and rotate around Z. Previously saved browser projects using the older `(x, z)` floor format are migrated when loaded.

## Run locally

Prerequisites: Node.js 20+, Python 3.12+, and optionally `ffmpeg` for server-side walkthrough-video frame sampling. The commands below are the same on macOS, Linux, and Windows (PowerShell or Command Prompt).

```bash
npm install
npm run backend:setup
```

`backend:setup` finds Python 3.12+ (`python3`/`python` on macOS and Linux, the `py` launcher or `python` on Windows), creates `.venv`, and installs `backend/requirements-dev.txt`. Re-run it after backend requirements change.

Copy `.env.example` to `.env.local` (macOS/Linux: `cp .env.example .env.local`; Windows PowerShell: `Copy-Item .env.example .env.local`). Next.js reads it for the frontend, and the backend scripts load `.env` and `.env.local` for FastAPI; variables already set in your shell take precedence.

Start both servers in one terminal:

```bash
npm run dev:all
```

Or run them separately: `npm run backend:dev` (FastAPI on port 8000) and `npm run dev` (Next.js on port 3000). Extra arguments pass through, for example `npm run backend:dev -- --port 8001`.

Open [http://localhost:3000](http://localhost:3000), choose **Open room** on the seeded Maple Hall project, and use **Reset demo** whenever you want the deterministic starting state back.

To invite a remote roommate, open a room and choose **Share**. Pick view or edit access, an expiry, and a collaborator limit, then send the generated link. The FastAPI service must be reachable from the roommate's device: deployed builds should set `NEXT_PUBLIC_API_URL` to the public HTTPS API origin and include the web origin in `ALLOWED_ORIGINS`. Invite links are bearer secrets. Room photos, videos, and imported screenshots are stripped before the shared snapshot is stored. Roommates explicitly **Refresh** before editing and **Publish changes** afterward; optimistic revisions reject stale publishes instead of silently overwriting someone else's work.

The app remains useful without an OpenAI key: measurements, 3D editing, product manual entry, placement checks, issue detection, and Better Cart all continue to work. AI endpoints return explicit manual fallbacks instead of fabricated values.

The guided scanner needs camera permission and a secure browser context (`localhost` works during development; deployed environments need HTTPS). It records overlapping still images rather than depth data. Roominate samples representative viewpoints for the guarded AI request, retains the complete scan locally when size permits, and requires users to review measurements before relying on fit results.

Room and product-image uploads accept HEIC/HEIF in addition to JPEG, PNG, WebP, and GIF. Because browser and model support varies, HEIC/HEIF uploads are decoded server-side, orientation-corrected, bounded to 50 megapixels, resized to at most 2400 pixels per side, and returned as a non-cached JPEG for preview and analysis. Individual uploads remain capped at 8 MB.

When OpenAI is configured, the same guarded analysis request returns schema-validated wall/floor/ceiling polygons, visible corner points, openings, three dimension assessments, confidence, evidence, and uncertainty notes. Coordinates are normalized and displayed over the analyzed frames. Confirmed measurements are enforced again in server code; visual estimates must be explicitly accepted and remain labeled unverified until the user confirms them.

Product URL and screenshot extraction also return a constrained 3D visual profile. If a user changes the product name, category, or variant, the confirmation form clears the stale profile and offers **Generate style**. This cached call may choose only renderer-supported archetypes, materials, silhouettes, and variants; it cannot emit geometry or executable code, and it never changes measured dimensions or collision bounds.

## Environment variables

Copy `.env.example`. The main settings are:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:8000` | Browser-visible FastAPI origin; it contains no secret. |
| `OPENAI_API_KEY` | No | unset | Enables room/screenshot understanding, product extraction, and proposal explanation. Server only. |
| `OPENAI_MODEL` | No | `gpt-4.1-mini` | Image-capable Responses API model. |
| `OPENAI_IMAGE_DETAIL` | No | `low` | Controls image token use. |
| `OPENAI_AGGREGATE_SPEND_GUARD_USD` | No | `9.00` | Hard preflight ledger guard, leaving $1 of the $10 credits reserved. |
| `OPENAI_MAX_CALLS_PER_PROJECT` | No | `6` | Per-project model-call limit; cache hits do not count. |
| `OPENAI_MAX_ESTIMATED_CALL_USD` | No | `0.08` | Amount reserved atomically before each request. |
| `OPENAI_INPUT_COST_PER_1M` | No | `0.40` | Cost estimator input rate; update when changing model. |
| `OPENAI_OUTPUT_COST_PER_1M` | No | `1.60` | Cost estimator output rate; update when changing model. |
| `ROOMINATE_AI_DB` | No | `backend/data/ai_cache.sqlite` | SQLite cache and usage ledger path. |
| `ALLOWED_ORIGINS` | No | localhost origins | Comma-separated CORS origins. |
| `AMAZON_CREDENTIAL_ID` | No | unset | Amazon Creators API OAuth credential ID; server only. |
| `AMAZON_CREDENTIAL_SECRET` | No | unset | Amazon Creators API OAuth secret; server only. |
| `AMAZON_CREDENTIAL_VERSION` | No | `3.1` | Credential version used to select the regional OAuth endpoint. |
| `AMAZON_PARTNER_TAG` | No | unset | Accepted Amazon Associates partner tag. |
| `AMAZON_MARKETPLACE` | No | `www.amazon.com` | Marketplace sent to catalog search. |

The default rate values were checked against the official [GPT-4.1 mini model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini). If the model changes, update both cost variables before making calls.

## Retailer discovery and checkout

The **Products → Shop** screen searches Amazon through the official Creators API when its server-side credentials are configured. Results with complete physical dimensions are run through Roominate's code-based collision and boundary checks; incomplete dimensions stay explicitly marked **Fit unverified**. Adding a result creates a normal shared-cart item and, when possible, places it in the room.

At checkout, Roominate groups products by retailer and opens source listings for users to verify variants and add to each retailer's cart. It does not collect payment details, mutate a retailer cart, or submit an order. IKEA remains a browse-and-import workflow because its U.S. terms currently prohibit automated scraping and unauthorized deep-linking; a direct catalog integration should only be enabled after receiving IKEA permission or an approved partner feed.

## OpenAI boundary and spending safety

The browser never receives `OPENAI_API_KEY`. FastAPI sends bounded requests to `/v1/responses` with strict JSON Schemas, validates responses with Pydantic, and then applies deterministic project rules. Model text cannot decide collision, clearance, subtotal, or confirmed policy outcomes.

Results are cached by operation, content hash, prompt/schema version, model, and image-detail setting. A SQLite ledger atomically reserves estimated cost before a call, enforces the aggregate and per-project limits, records actual token usage, and bypasses spend for cache hits. Images are capped in size/count and use low detail by default; videos are sampled to at most three frames when `ffmpeg` is available.

## Demo walkthrough

The seeded demo deliberately derives these issues from fixture geometry and records:

- a wide desk crossing the room boundary and colliding with the chair
- an owned roommate shelf blocking the confirmed entry-door swing
- two roommates planning microwaves for the same shared need
- an open-coil heater matching a confirmed user-entered housing rule
- a $595 known subtotal against a $400 group budget
- unplaced cart products whose fit remains unverified

Generate Better Cart to collision-test a compact desk placement, coordinate/defer the duplicate, remove the rule-conflicting heater, and reposition the shelf. With every proposal action accepted, deterministic tests verify a $327 subtotal and resolution of fit, clearance, budget, duplicate, and rule issues; the remaining unplaced microwave is correctly still reported as fit-unverified.

## Verification

```bash
npm test
npm run build
npm run backend:test
npm run test:e2e
```

The Playwright suite covers the desktop demo/proposal/apply/undo flow, the URL-import manual fallback through the running FastAPI service, and a phone viewport with the 3D room and bottom navigation. Install the browser once with `npx playwright install chromium`.

## Development-scope limitations

- Personal projects remain browser-local. Remote invite snapshots are persisted in the configured SQLite database and support explicit refresh/publish with conflict detection, but they are not realtime and links are bearer-token access rather than account-based production authorization. Use HTTPS and a durable managed database/object store before production.
- Uploaded files under 3 MB may be retained as local data URLs. Larger files retain metadata only in this development substitute. Production should use private object storage, signed access, and deletion jobs.
- Room reconstruction returns reviewable geometry/features and palette suggestions, but the current UI uses confirmed rectangular dimensions as its scale anchor rather than a full photogrammetry or LiDAR mesh.
- Product URL extraction depends on what a store permits the backend to read. Blocked pages always fall back to an editable draft with the URL retained.
- Shipping and tax remain explicitly excluded unless entered into a future persisted cost model.
- Amazon live search requires an accepted Associates/Creators API account and was designed to degrade to an Amazon browse link when credentials or the service are unavailable. Retailer stock, prices, variants, and fit evidence must still be reconfirmed before purchase.

These boundaries are surfaced in the UI; none of them are silently presented as confirmed fit, live pricing, or deployed collaboration.
