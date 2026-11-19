# Decisions — P18 Student Carpooling

<!-- graffino-agentic:begin v1 -->
> Constraints the code must obey. Status: `approved` (obey) · `proposed` (do not
> build on it) · `superseded-by <ID>` (kept to explain old code).
> Adding or changing an entry needs the user's OK (AGENTS.md → The gate).
<!-- graffino-agentic:end -->

## Index
- D-001 · Semantic HTML, accessibility, and modern React components
- D-002 · Express REST API + OpenAPI documentation + React SPA
- D-003 · MySQL 8 with raw SQL migrations, idempotent seed, and SELECT FOR UPDATE
- D-004 · JWT authentication with university email domain allowlist
- D-005 · Segment availability pure function and DB concurrency integration tests
- D-006 · Recurring rides stored as rule + exceptions, materialised on demand
- D-007 · Stop-edit triggers pending_reconfirmation with lazy deadline enforcement
- D-008 · Ratings locked behind post-arrival server-side authorisation
- D-009 · Nominatim/Photon geocoding with MySQL geocoding_cache
- D-010 · Proportional segment pricing with declared trip cost cap
- D-011 · MySQL-backed REST polling for chat and notifications
- D-012 · Docker Compose full stack plus live URL deployment
- D-013 · Password hashing with bcrypt and server-side RBAC checks
- D-014 · Server-side schema validation with Zod and XSS prevention
- D-015 · GitHub Actions CI with MySQL service container
- D-016 · Dual reputation model with seriousness score and cancellation penalties
- D-017 · Configurable search radius with 1 km default

---

## D-001 · Semantic HTML, accessibility, and modern React components
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** The frontend UI is built using React with Vite (as decided in D-002), emphasizing semantic HTML5 elements, modular components, and accessible markup (WCAG basics) without bloated UI kit dependencies.
- **Why:** University web laboratories emphasize core web standards, accessibility, and fundamental concepts within modern React applications.
- **Rejected:** Heavy, bloated UI component frameworks by default.
- **Evidence:** P18 scope interview, 2026-11-19; aligns with D-002.
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

## D-003 · MySQL 8 with raw SQL migrations, idempotent seed, and SELECT FOR UPDATE
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** The database is MySQL 8, accessed with the `mysql2` driver and raw SQL (no ORM). Schema evolution is managed via sequential, numbered raw SQL migration files (e.g. `migrations/001_initial.sql`) applied at startup by a minimal custom runner tracking executed migrations in a `schema_migrations` table. Seed data (including the 10 real routes from SURVEY.md and system accounts) is managed via an idempotent script executed both in local development and on live deployment so real survey routes are always available. Concurrent overbooking is prevented with `SELECT FOR UPDATE` inside a MySQL transaction.
- **Why:** Full control over SQL queries, parameterised queries against SQL injection, graded compliance with versioned migrations, idempotent real-data seeding on live and local environments, and transactional row locking to prevent double-booking.
- **Evidence:** Coursework versioned migration requirements; SURVEY.md & P18 Definition of Done; scope interview, 2026-11-19.
- **Source:** user · confidence high

---

## D-004 · JWT authentication with university email domain allowlist
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Authentication uses email + password; a JWT is returned on login and stored in `localStorage`. University membership verification consists strictly of validating that the email format matches an allowed university domain allowlist at registration (e.g. `@ulbsibiu.ro`, `@stud.ubbcluj.ro`, `@student.utcluj.ro`). The UI and API must explicitly designate this as "domain-validated" and make clear that mailbox ownership is not confirmed via email verification link or code.
- **Why:** Lightweight student-only access verification without SMTP server overhead, with honest labeling that mailbox ownership is unverified.
- **Evidence:** P18 scope interview, 2026-11-19; Q-002 and Q-005.
- **Source:** user · confidence high

---

## D-005 · Segment availability pure function and DB concurrency integration tests
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Seat availability is calculated per segment (not per ride) in a pure function that takes segment bookings as input and returns available seat counts. This pure function is verified in Vitest across ≥ 8 unit test cases (single segment, overlapping segments, mid-route free seats, cancellations, modified stops). Concurrent overbooking prevention is separated from the pure unit tests and verified via a dedicated database integration test simulating concurrent booking attempts with `SELECT FOR UPDATE` transactions.
- **Why:** Isolates complex overlapping-segment logic so it is deterministic and verifiable with 8+ unit tests, while properly delegating transactional concurrency verification to integration tests against MySQL.
- **Evidence:** P18 project sheet (mandatory ≥ 8 tests); scope interview, 2026-11-19.
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

---

## D-013 · Password hashing with bcrypt and server-side RBAC checks
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Passwords must be hashed using `bcrypt` with a salt (work factor ≥ 10) before database persistence. Role-based access control (user, moderator, admin) is enforced server-side on every protected API endpoint, validating permissions from the verified JWT claims and verifying account status (e.g. active vs suspended) against the database.
- **Why:** Protects credentials against disclosure and guarantees role boundaries cannot be bypassed by client-side tampering.
- **Evidence:** P18 role specifications (user, moderator, admin); scope interview, 2026-11-19.
- **Source:** user · confidence high

---

## D-014 · Server-side schema validation with Zod and XSS prevention
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** All incoming API request bodies, queries, and route parameters must undergo strict schema validation using Zod before query execution or domain logic processing. On the frontend, React components must never use `dangerouslySetInnerHTML`, relying on React's automatic text escaping to prevent Cross-Site Scripting (XSS).
- **Why:** Comprehensive input validation preventing malformed or malicious payloads at the API boundary, paired with safe React rendering practices to prevent XSS without manual string escaping.
- **Evidence:** Standard web security practices for REST + React architectures.
- **Source:** user · confidence high

---

## D-015 · GitHub Actions CI with MySQL service container
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Continuous integration is implemented using GitHub Actions (`.github/workflows/ci.yml`), automatically executing test suites (Vitest unit and database integration tests) and running `python3 docs/agents/tools/ledger-lint.py` on pull requests and pushes to `main`. The CI workflow includes a containerized MySQL service container to support integration tests (migrations, seeds, and transactional concurrency locking).
- **Why:** Enforces automated grading compliance, test coverage, transactional integrity, and ledger consistency on every commit.
- **Evidence:** P18 project requirements and agent ledger rules.
- **Source:** user · confidence high

---

## D-016 · Dual reputation model with seriousness score and cancellation penalties
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** The platform maintains two independent reputation metrics: a 1–5 star rating (mutual, submitted only after completed rides per D-008) and a percentage-based seriousness score. The seriousness score scale is 0% to 100% (start value 100%, minimum 0%, maximum 100%). The score is not stored in the database: it is computed on read by a pure function that replays the user's infraction events in chronological order (applying penalties, clamping to 0..100, adding weekly recovery of +1 percentage point per full 7 days without a new infraction, and clamping to 100%). Late cancellations incur the following consequences:
  1. Driver cancelling on the day of departure (with confirmed passengers): −5 percentage points penalty, an "Anulare recentă" (Recent Cancellation) profile badge active for 30 days, and a temporary ban from publishing new rides for 7 days.
  2. Passenger cancelling < 4 hours before departure: −3 percentage points penalty and obligation to pay a cancellation fee equal to 50% of the booked segment price, capped at 20 lei. This cancellation fee is a penalty outside the D-010 passenger fare sum cap. The fee is recorded by the app as an amount owed by the passenger to the driver, displayed to both parties on the cancelled booking, and settled directly between them outside the app (the app does not process payments or collect money). Known limitation: if the freed seat is subsequently booked by another passenger, the driver may end up with slightly more than the declared trip cost (at most +20 lei).
- **Why:** Event-sourced on-read calculation avoids background cron jobs and state drift while supporting deterministic recovery over time. Protects both parties against last-minute disruptions (fear #2 in SURVEY.md at 56%), creates tangible accountability without relying solely on subjective star reviews, and keeps penalty fees distinct from shared travel expense caps.
- **Evidence:** SURVEY.md §3 & §4 for directional consensus (78% driver penalty, 72% notification, 67% passenger score penalty, 61% partial payment). The penalty amounts (−5 pp, −3 pp), recovery rate (+1 pp per 7 clean days), 4h threshold, 50% / 20 lei fee cap, 7-day ban, and 30-day badge are author-defined project parameters.
- **Source:** user decision

---

## D-017 · Configurable search radius with 1 km default
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Ride segment matching applies a default spatial search radius of 1 km around pickup and drop-off coordinates, with an optional passenger-selected expansion up to a maximum of 5 km in the search query.
- **Why:** Directly codifies the SURVEY.md findings where 100% of respondents accept 1 km, 56% accept 3 km, and 28% accept 5 km.
- **Evidence:** SURVEY.md §3; confirmed in scope interview, 2026-11-19.
- **Source:** user · confidence high
