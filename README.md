![Roominate](brand/roominate-logo.png)

Roominate is a responsive, shared-room planning app for answering a practical question: does the group cart fit the room, budget, roommate inventory, housing rules, and actual needs?

The repository is a working vertical slice built from the supplied PRD:

- Next.js + TypeScript responsive frontend
- React Three Fiber room editor in real-world meter units
- FastAPI service for server-only OpenAI Responses API calls
- deterministic collision, clearance, duplicate, rule, and budget checks
- local development persistence with a resettable full-flow demo
- browser-based guided room capture with six viewpoints, quality feedback, and a measured scale reference
- floor plan scanning that traces a room's shape (including L-shapes and other non-rectangular rooms) from a plan image, scaled from any one measured or printed wall
- dimension-scaled procedural 3D models for chairs, couches, desks, wardrobes, hampers, beanbags, ottomans, dressers, lamps, mirrors, and mini fridges
- schema-constrained OpenAI visual profiles that turn product pictures or descriptions into bounded primitive parts, with safe procedural archetypes as a fallback
- a built-in 59-item IKEA/Amazon furnishing shortlist with placement dimensions, reviewable pricing evidence, and direct retailer links
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

**Scan a floor plan** (Room capture → Confirm dimensions) traces the room's outline from a screenshot or photo of a housing plan. The tracing runs entirely in the browser and uses no AI. It grows the room's fill colour from the spot you click, absorbs the small pockets that door swings, labels, and furniture outlines cut out of it, and closes doorways so a white room on a white page doesn't leak into the hall. It then straightens the edge into walls, correcting a plan photographed at a slight angle. The walls are lettered A, B, C… clockwise from the top-left. Enter the real length of any one wall and every other wall scales from it; measurements on both axes scale each axis separately. Without a measurement the shape keeps its proportions at the current floor area and is labelled an estimate. A plain rectangle is stored as width × length. Any other shape is stored in `Room.outline` as fractions of the overall width and length, and the fit checks, 3D walls, floor grid, and room thumbnails all follow it. Optionally, **Read printed dimensions** sends the plan and a copy with the lettered outline to `POST /api/v1/read-floor-plan`. The model only transcribes dimension labels and locates doors and windows. Code parses each printed label (such as `12'-6"` or `3.81 m`) into meters and drops anything that doesn't state a length. The user chooses which readings to use, and doors and windows are added unconfirmed.

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
| `VISA_R2P_MODE` | No | `demo` | `demo` keeps all payment requests local; `sandbox` calls Visa. |
| `VISA_R2P_USERNAME` / `VISA_R2P_PASSWORD` | Sandbox | unset | Visa Developer mutual-TLS credentials; server only. |
| `VISA_R2P_CLIENT_CERT` / `VISA_R2P_CLIENT_KEY` | Sandbox | unset | Paths to the Visa project client certificate and its private key. |
| `VISA_R2P_MLE_KEY_ID` | Sandbox | unset | Visa Message Level Encryption key ID. |
| `VISA_R2P_MLE_SERVER_CERT` | Sandbox | unset | Path to Visa's MLE public certificate used to encrypt requests. |
| `VISA_R2P_MLE_PRIVATE_KEY` | Sandbox | unset | Path to Roominate's MLE private key used to decrypt responses. |
| `VISA_R2P_CREDITOR_AGENT_ID` / `VISA_R2P_DEBTOR_AGENT_ID` | Sandbox | unset | Agent IDs supplied during Visa Request to Pay onboarding. |
| `VISA_R2P_SETTLEMENT_PAN` | Sandbox | unset | Visa-provided sandbox test PAN used as the `VISA_DIRECT` settlement option; never use a real card number. |
| `VISA_R2P_SIMULATOR_SCENARIO` | No | `X_2_X_X` | Visa debtor simulator state sequence. `X_2_X_X` settles; `X_3_X_X` rejects. |
| `VISA_R2P_COUNTRY` | No | `US` | Two-letter country used for the sandbox participants. |

The default rate values were checked against the official [GPT-4.1 mini model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini). If the model changes, update both cost variables before making calls.

## Retailer discovery and checkout

The **Products → Shop** screen searches Amazon through the official Creators API when its server-side credentials are configured. Results with complete physical dimensions are run through Roominate's code-based collision and boundary checks; incomplete dimensions stay explicitly marked **Fit unverified**. Adding a result creates a normal shared-cart item and, when possible, places it in the room.

At checkout, Roominate groups products by retailer and opens source listings for users to verify variants and add to each retailer's cart. It does not collect payment details, mutate a retailer cart, or submit an order. IKEA remains a browse-and-import workflow because its U.S. terms currently prohibit automated scraping and unauthorized deep-linking; a direct catalog integration should only be enabled after receiving IKEA permission or an approved partner feed.

After retailer checkout, **Products → Group cart → Settle expenses** treats each assigned buyer as the person who paid, splits every confirmed priced purchase equally, and conserves exact cents in server code. It can create lifecycle-tracked Visa Direct Request to Pay messages. Default demo mode supports local accept/reject states without moving funds. Visa sandbox mode uses server-only mutual TLS and required JWE message-level encryption; it does not store raw card numbers and is not production payment approval.

## OpenAI boundary and spending safety

The browser never receives `OPENAI_API_KEY`. FastAPI sends bounded requests to `/v1/responses` with strict JSON Schemas, validates responses with Pydantic, and then applies deterministic project rules. Model text cannot decide collision, clearance, subtotal, or confirmed policy outcomes.

Results are cached by operation, content hash, prompt/schema version, model, and image-detail setting. A SQLite ledger atomically reserves estimated cost before a call, enforces the aggregate and per-project limits, records actual token usage, and bypasses spend for cache hits. Images are capped in size/count and use low detail by default (floor plan reading uses high detail, because dimension labels are small print); videos are sampled to at most three frames when `ffmpeg` is available.

## Demo walkthrough

The seeded demo uses only real products from the furnishing shortlist and deliberately derives these issues from fixture geometry and records:

- a 55″ IKEA LAGKAPTEN / ALEX desk crossing the east wall and colliding with the FLINTAN chair
- Maya's owned KJUGE pouf blocking the confirmed entry-door swing
- two roommates planning floor lamps (LAUTERS and BARLAST) for the same room-lighting need
- an Igloo 3.2 cu ft mini fridge matching a confirmed user-entered rule against fridges over 3.0 cu ft
- a $589.95 known subtotal against a $400 group budget
- Maya's BARLAST lamp starts unplaced in the fixture, so its fit is unverified (when a saved project loads, the app auto-places shortlist items, so in the browser the lamp usually appears already placed)

The demo marks the TORALD desk and the Frigidaire 10 L mini fridge as alternatives to the desk and fridge in the cart. Better Cart only swaps to a shortlist product in the same alternative group, so other catalog items are never suggested automatically.

Generate Better Cart to swap the fridge for its permitted alternative, defer the duplicate lamp, swap to the compact TORALD desk at a collision-tested placement, and move the pouf out of the door swing. With every proposal action accepted, deterministic tests verify a $194.94 subtotal and resolution of fit, clearance, budget, duplicate, and rule issues; in the fixture, Maya's unplaced lamp is correctly still reported as fit-unverified.

Saved browser copies of the earlier demo (which used made-up products) are replaced with this demo on load; **Reset demo** also restores it.

## Verification

```bash
npm test
npm run build
npm run backend:test
npm run test:e2e
```

The Playwright suite covers the desktop demo/proposal/apply/undo flow, the URL-import manual fallback through the running FastAPI service, tracing and scaling an L-shaped floor plan, and a phone viewport with the 3D room and bottom navigation. Install the browser once with `npx playwright install chromium`.

## Development-scope limitations

- Personal projects remain browser-local. Remote invite snapshots are persisted in the configured SQLite database and support explicit refresh/publish with conflict detection, but they are not realtime and links are bearer-token access rather than account-based production authorization. Use HTTPS and a durable managed database/object store before production.
- Uploaded files under 3 MB may be retained as local data URLs. Larger files retain metadata only in this development substitute. Production should use private object storage, signed access, and deletion jobs.
- Room reconstruction returns reviewable geometry/features and palette suggestions, but the current UI uses confirmed dimensions (or a scaled floor plan outline) as its scale anchor rather than a full photogrammetry or LiDAR mesh.
- Floor plan tracing works on raster images. PDFs need a screenshot first. Doors and windows on angled walls are drawn square to the nearest compass direction.
- Product URL extraction depends on what a store permits the backend to read. Blocked pages always fall back to an editable draft with the URL retained.
- Shipping and tax remain explicitly excluded unless entered into a future persisted cost model.
- Amazon live search requires an accepted Associates/Creators API account and was designed to degrade to an Amazon browse link when credentials or the service are unavailable. Retailer stock, prices, variants, and fit evidence must still be reconfirmed before purchase.

These boundaries are surfaced in the UI; none of them are silently presented as confirmed fit, live pricing, or deployed collaboration.
