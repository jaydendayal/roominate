# Roominate

Roominate is a responsive, shared-room planning app for answering a practical question: does the group cart fit the room, budget, roommate inventory, housing rules, and actual needs?

The repository is a working vertical slice built from the supplied PRD:

- Next.js + TypeScript responsive frontend
- React Three Fiber room editor in real-world meter units
- FastAPI service for server-only OpenAI Responses API calls
- deterministic collision, clearance, duplicate, rule, and budget checks
- local development persistence with a resettable full-flow demo
- collision-tested Better Cart actions with individual accept/reject and undo

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

The app remains useful without an OpenAI key: measurements, 3D editing, product manual entry, placement checks, issue detection, and Better Cart all continue to work. AI endpoints return explicit manual fallbacks instead of fabricated values.

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

The default rate values were checked against the official [GPT-4.1 mini model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini). If the model changes, update both cost variables before making calls.

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

- Project persistence is browser-local rather than PostgreSQL/object storage. Sharing copies a private-labeled local link; it is not a production multi-user authorization or realtime collaboration service.
- Uploaded files under 3 MB may be retained as local data URLs. Larger files retain metadata only in this development substitute. Production should use private object storage, signed access, and deletion jobs.
- Room reconstruction returns reviewable geometry/features and palette suggestions, but the current UI uses confirmed rectangular dimensions as its scale anchor rather than a full photogrammetry or LiDAR mesh.
- Product URL extraction depends on what a store permits the backend to read. Blocked pages always fall back to an editable draft with the URL retained.
- Shipping and tax remain explicitly excluded unless entered into a future persisted cost model.

These boundaries are surfaced in the UI; none of them are silently presented as confirmed fit, live pricing, or deployed collaboration.
