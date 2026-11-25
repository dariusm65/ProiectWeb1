# Contracts — ULBS-Laborator

<!-- graffino-agentic:begin v1 -->
> Promises across a boundary. **Provided:** this repo owns the contract; the text
> lives here only. **Consumed:** a link to the provider's entry plus the fields this
> repo relies on. **External:** what we rely on from a third-party service.
> Changing a provided contract is a PROPOSAL (AGENTS.md → The gate) and the plan
> lists the consumers' files too. Status: `approved` · `proposed` · `superseded-by`.
<!-- graffino-agentic:end -->

## Index
- C-002 · Moderation report reason enum, pending deduplication, and single-query enriched admin reports · provided
- C-001 · OpenStreetMap Nominatim usage policy and rate limiting · external

---

## Provided

### C-002 · Moderation report reason enum, pending deduplication, and single-query enriched admin reports
- **Status:** approved
- **Confirmed:** 2026-11-25
- **Interface:**
  - `POST /api/reports` validates `reason` against the fixed enum `['spam', 'harassment', 'unsafe_driving', 'no_show', 'fake_profile', 'inappropriate_content', 'other']` (shared between `backend/src/domain/reportReasons.js` and `frontend/src/domain/reportReasons.js`), optional `details` (`<= 2000` chars), and at least one target (`reported_user_id`, `ride_id`, or `message_id`). If the authenticated reporter already has a `pending` report for the exact same `(reported_user_id, ride_id, message_id)` tuple, the server returns `409 REPORT_ALREADY_PENDING`.
  - `GET /api/admin/reports` accepts optional `status` (`pending | resolved | dismissed`) and `limit` (`1..200`, default `100`) and executes a single `LEFT JOIN` query returning each report enriched with `reporter: { id, full_name }`, `reported_user: { id, full_name, role, is_suspended }`, `ride: { id, origin_name, destination_name, departure_time, status, driver_id }`, `message: { id, ride_id, excerpt, sender_id, sender_name }` (truncated to 280 chars), and `resolved_by_name` — exposing zero emails, phones, gender, or password hashes on report rows.
- **Consumers:** `frontend/src/api/client.js`, `frontend/src/components/ReportModal.jsx`, `frontend/src/pages/AdminPage.jsx`.
- **Evidence:** Slice 8 planning gate (answers 3, 4, 6), 2026-11-25; `CONTEXT.md` ("Report").
- **Source:** user · confidence high

## Consumed

## External

### C-001 · OpenStreetMap Nominatim usage policy and rate limiting
- **Status:** approved
- **Confirmed:** 2026-11-23
- **Interface:** Outbound HTTP requests to `https://nominatim.openstreetmap.org/search` and `/reverse` (`format=jsonv2`) must send a descriptive custom `User-Agent` header identifying the StudRide ULBS coursework project, enforce an in-process rate limit of at most 1 request per second (`>= 1.1 s` gap between outbound requests), and persist results in MySQL `geocoding_cache` (`D-009`). Cache hits, `known_places` hits, and injected test `fetchFn` mocks with `throttleMs: 0` must never be throttled.
- **Evidence:** OpenStreetMap Nominatim Usage Policy (max 1 req/sec, custom User-Agent, caching); Slice 4A planning gate, 2026-11-23.
- **Source:** user · confidence high
