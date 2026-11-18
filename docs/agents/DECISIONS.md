# Decisions — P18 Student Carpooling

<!-- graffino-agentic:begin v1 -->
> Constraints the code must obey. Status: `approved` (obey) · `proposed` (do not
> build on it) · `superseded-by <ID>` (kept to explain old code).
> Adding or changing an entry needs the user's OK (AGENTS.md → The gate).
<!-- graffino-agentic:end -->

## Index
- D-001 · Semantic HTML and modern ES6+ standards
- D-002 · Express REST API + OpenAPI documentation + React SPA
- D-003 · MySQL 8 with mysql2 raw SQL and SELECT FOR UPDATE
- D-004 · JWT authentication with university email domain allowlist
- D-005 · Segment availability as a pure function tested with Vitest
- D-006 · Recurring rides stored as rule + exceptions, materialised on demand
- D-007 · Stop-edit triggers pending_reconfirmation with lazy deadline enforcement
- D-008 · Ratings locked behind post-arrival server-side authorisation
- D-009 · Nominatim/Photon geocoding with MySQL geocoding_cache
- D-010 · Proportional segment pricing with declared trip cost cap
- D-011 · MySQL-backed REST polling for chat and notifications
- D-012 · Docker Compose full stack plus live URL deployment

---

## D-001 · Semantic HTML and modern ES6+ standards
- **Status:** approved
- **Date:** 2026-11-05
- **Rule:** Use semantic HTML5 elements and standard ES6+ JavaScript syntax without unnecessary heavy external dependencies unless specified by the assignment.
- **Why:** University web laboratories emphasize core web standards, accessibility, and fundamental concepts.
- **Rejected:** Heavy bundling frameworks by default.
- **Evidence:** Coursework curriculum requirements.
- **Source:** user · confidence high

---

## D-002 · Express REST API + OpenAPI documentation + React SPA
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** The backend is Node.js + Express serving a REST API documented with OpenAPI/Swagger. The frontend is a React + Vite SPA. The two layers communicate only through the REST API.
- **Why:** Clean frontend/backend separation and mandatory OpenAPI documentation for grading.
- **Evidence:** P18 scope interview, 2026-11-19; P18 project sheet (OpenAPI requirement explicit).
- **Source:** user · confidence high

---

## D-003 · MySQL 8 with mysql2 raw SQL and SELECT FOR UPDATE
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** The database is MySQL 8, accessed with the `mysql2` driver and raw SQL. No ORM. The schema and seed data are defined in a `.sql` file loaded at startup. Concurrent overbooking is prevented with `SELECT FOR UPDATE` inside a MySQL transaction.
- **Why:** Full control over SQL queries, easy demonstration of parameterised queries against SQL injection, and transactional row locking to prevent double-booking when two users book simultaneously.
- **Evidence:** P18 scope interview, 2026-11-19.
- **Source:** user · confidence high

---

## D-004 · JWT authentication with university email domain allowlist
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Authentication uses email + password; a JWT is returned on login and stored in `localStorage`. University membership is verified at registration by checking the email domain against a backend config allowlist (e.g. `@ulbsibiu.ro`, `@stud.ubbcluj.ro`, `@student.utcluj.ro`). No confirmation email is sent.
- **Why:** Lightweight student-only access verification without SMTP server overhead.
- **Evidence:** P18 scope interview, 2026-11-19; Q-002 (domain list stays `investigating` until confirmed).
- **Source:** user · confidence high

---

## D-005 · Segment availability as a pure function tested with Vitest
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Seat availability is calculated per segment (not per ride) in a pure function that takes segment bookings as input and returns available seat counts. This function is tested in Vitest with ≥ 8 cases (overlapping segments, cancellations, modified stops, concurrent overbooking). Database enforcement uses `SELECT FOR UPDATE` inside a transaction (see D-003).
- **Why:** Isolates complex overlapping-segment logic so it is deterministic and verifiable with 8+ unit tests as required by P18.
- **Evidence:** P18 project sheet (mandatory ≥ 8 tests); P18 scope interview, 2026-11-19.
- **Source:** user · confidence high

---

## D-006 · Recurring rides stored as rule + exceptions, materialised on demand
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** A recurring ride is stored as a rule row (days of week, optional end date) plus an exceptions table. When a passenger searches a specific date, the backend evaluates active rules, skips exception dates, and materialises a concrete ride instance row for that date. Bookings, chat, and stop edits attach to the instance, not the rule. A driver adding an exception cancels existing bookings on that instance and notifies affected passengers.
- **Why:** Avoids generating infinite future rows while allowing single-date cancellations/edits and per-instance bookings.
- **Evidence:** P18 project sheet (recurring rides requirement); P18 scope interview, 2026-11-19.
- **Source:** user · confidence high

---

## D-007 · Stop-edit triggers pending_reconfirmation with lazy deadline enforcement
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** When a driver modifies or deletes a stop after confirmed bookings exist, all affected bookings (whose pickup, drop-off, or traversed segment includes that stop) transition to `pending_reconfirmation`. The reconfirmation deadline is computed as: if modified > 2 h before departure → `min(now + 6 h, departure − 2 h)`; if modified ≤ 2 h before departure → `min(now + 30 min, departure)`. Passengers must accept or decline; if the deadline passes without a response, the booking auto-lapses and the seat is freed. The deadline is evaluated lazily on read — no background cron worker. Drivers cannot manually release a `pending_reconfirmation` seat before the deadline.
- **Why:** Protects booked passengers from unannounced route changes without needing background cron workers.
- **Evidence:** P18 project sheet (stop-modification twist); user answers to Q-1 and Q-2, 2026-11-19.
- **Source:** user · confidence high

---

## D-008 · Ratings locked behind post-arrival server-side authorisation
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** A rating can only be submitted by a confirmed participant of a specific ride, and only after the ride's estimated arrival time has passed. This is enforced server-side in the rating POST endpoint. A Vitest + Supertest test must assert that a rating submitted before arrival is rejected with an appropriate error.
- **Why:** Prevents fake/premature reviews and satisfies the P18 authorisation test requirement.
- **Evidence:** P18 project sheet (authorisation test requirement); P18 scope interview, 2026-11-19.
- **Source:** user · confidence high

---

## D-009 · Nominatim/Photon geocoding with MySQL geocoding_cache
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Forward and reverse geocoding is provided by Nominatim/Photon. Results are cached in a `geocoding_cache` MySQL table (keyed by query string or coordinate pair) to prevent repeated external calls. The cache persists across server restarts. No Redis instance is added to Docker Compose. Both typed autocomplete (forward) and map-click (reverse) geocoding are supported in the driver stop-entry UI.
- **Why:** Avoids external API rate limits, persists cache across restarts, and removes the need for Redis in Docker Compose.
- **Evidence:** P18 project sheet (Nominatim/Photon + cache requirement); P18 scope interview, 2026-11-19.
- **Source:** user · confidence high

---

## D-010 · Proportional segment pricing with declared trip cost cap
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Each segment's price is computed proportionally to its distance relative to the total ride distance and the driver's declared trip cost. A passenger's total equals the sum of prices for each segment they traverse. The sum of all passenger payments for a ride must not exceed the driver's declared trip cost. This constraint is enforced server-side at booking time and displayed transparently to the passenger before confirmation.
- **Why:** Directly implements the SURVEY.md rules (67% cost-only, 61% proportional) and ensures fair cost-sharing without driver profit.
- **Evidence:** SURVEY.md §3 (variable table: pricing rule, 61%/67% support); P18 scope interview, 2026-11-19.
- **Source:** user · confidence high

---

## D-011 · MySQL-backed REST polling for chat and notifications
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Per-ride chat messages and in-app notifications are stored in MySQL tables. The React frontend fetches them via REST GET endpoints authenticated with JWT, polling every few seconds. No WebSockets, Server-Sent Events, or Socket.io are used.
- **Why:** Keeps architecture simple and reliable without WebSocket state management.
- **Evidence:** P18 scope interview, 2026-11-19; suitable for local/academic demo context.
- **Source:** user · confidence high

---

## D-012 · Docker Compose full stack plus live URL deployment
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** The full stack (MySQL 8 + Express backend + React frontend) must start with a single `docker compose up` command for grading. The same codebase also supports `npm run dev` for local development with MySQL in Docker and the backend/frontend on the host. The app is additionally deployed to a live URL (Render / Railway / VPS) to satisfy the P18 Definition of Done (≥ 5 real colleagues on the live instance).
- **Why:** Enables one-command local grading, fast local iteration, and fulfills the P18 Definition of Done (5 real colleagues on live).
- **Evidence:** P18 project sheet (Definition of Done); P18 scope interview, 2026-11-19.
- **Source:** user · confidence high
