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
- D-018 · Women-only ride preference and eligibility rule

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
- **Rule:** The database is MySQL 8, accessed with the `mysql2` driver and raw SQL (no ORM). Schema evolution is managed via sequential, numbered raw SQL migration files applied at startup by a minimal custom runner tracking executed migrations in a `schema_migrations` table. Seed data (including real survey routes and system accounts) is managed via an idempotent script executed both in local development and on live deployment so real survey routes are always available. Concurrent overbooking is prevented with `SELECT FOR UPDATE` inside an InnoDB transaction. Pending booking requests do NOT consume seat capacity; only bookings in `confirmed` and `pending_reconfirmation` statuses hold seats. When a driver accepts a pending request inside an InnoDB `SELECT FOR UPDATE` transaction, the backend auto-rejects ONLY those competing pending requests whose route traverses at least one elementary leg whose remaining capacity has just dropped to 0 (competing pending requests that overlap on legs where remaining capacity is still >= 1 remain `pending`). Passengers are notified when their pending request is auto-rejected or becomes `expired`. Unanswered pending requests automatically transition to `expired` at the ride's scheduled departure time, evaluated lazily on read (no background cron jobs).
- **Why:** Full control over SQL queries, parameterised queries against SQL injection, compliance with versioned migrations, idempotent real-data seeding, and selective transactional row locking to prevent double-booking without prematurely rejecting valid overlapping requests.
- **Evidence:** Coursework versioned migration requirements; scope interview and decision refinements, 2026-11-19.
- **Source:** user · confidence high

---

## D-004 · JWT authentication with university email domain allowlist
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Authentication uses email + password; a JWT is returned on login and stored in `localStorage`. Anyone can register with any valid email address so testers without a university address can still use the app. University domain status verification consists strictly of validating that the user's email format matches an approved university domain allowlist at registration (e.g. `@ulbsibiu.ro`, `@stud.ubbcluj.ro`, `@student.utcluj.ro`, `@student.upt.ro`, `@e-uvt.ro`, `@stud.acs.upb.ro`, `@unibuc.ro`). Only matching accounts receive the "university domain" badge. The UI, API, and documentation must explicitly label this badge as "domain-validated" (not identity-verified) and disclose that mailbox ownership is unverified. Filter label "Doar șoferi validați universitar" is retained for UI consistency.
- **Why:** Enables testers without an academic email to access the app while honestly disclosing that domain validation does not verify mailbox ownership or physical student identity.
- **Evidence:** P18 scope interview, 2026-11-19; Q-002 and Q-005.
- **Source:** user · confidence high

---

## D-005 · Segment availability pure function and DB concurrency integration tests
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Seat availability is calculated per segment (not per ride) in a pure function that takes segment bookings as input and returns available seat counts. Only bookings in `confirmed` and `pending_reconfirmation` statuses consume segment capacity; `pending`, `expired`, `rejected`, and `cancelled` bookings do not. This pure function is verified in Vitest across >= 8 unit test cases (single segment, overlapping segments, mid-route free seats, cancellations, modified stops, and partial-overlap non-rejection cases). Concurrency and transactional row-locking (including the selective rejection of competing pending requests only on saturated legs) are verified via a dedicated database integration test simulating concurrent requests using `SELECT FOR UPDATE` transactions.
- **Why:** Isolates complex overlapping-segment logic so it is deterministic and verifiable with 8+ unit tests, while properly delegating transactional concurrency verification to integration tests against MySQL.
- **Evidence:** P18 project sheet (mandatory >= 8 tests); scope interview and decision refinements, 2026-11-19.
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
- **Rule:** When a driver modifies or deletes a stop after confirmed bookings exist, all affected bookings (whose pickup, drop-off, or traversed segment includes that stop) transition to `pending_reconfirmation`. The reconfirmation deadline is computed as: if modified > 2 h before departure -> `min(now + 6 h, departure - 2 h)`; if modified <= 2 h before departure -> `min(now + 30 min, departure)`. Passengers must accept or decline; if the deadline passes without a response, the booking auto-lapses and the seat is freed (evaluated lazily on read). Drivers receive an in-app notification upon lapse; notifications generated lazily on read must be idempotent (created once per lapse). Drivers cannot manually release a `pending_reconfirmation` seat before the deadline.
- **Why:** Protects booked passengers from unannounced route changes without needing background cron workers, and ensures drivers are idempotently notified when seats are freed.
- **Evidence:** P18 project sheet (stop-modification twist); user answers to Q-1, Q-2, and Q-003, 2026-11-19.
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
- **Rule:** Each segment's price is computed proportionally to distance, and the driver shares trip costs equally with passengers: `seat_full_price = declared_trip_cost / (available_seats + 1)`. Cumulative prices from origin to each stop i use the formula: `cum(i) = (dist(origin -> i) / total_dist) * seat_full_price`. Any segment interval [A, B] price is computed as: `segment_price(A, B) = round_half_up(cum(B)) - round_half_up(cum(A))` in integer lei (0.5 rounded up). Sub-segment prices always sum identically to the full-route seat price without clamping. The calculated price is permanently stored on the booking record as `price_lei` at booking creation time; subsequent driver edits to `declared_trip_cost` or `available_seats` apply only to future bookings. The invariant that the sum of all passenger payments on a ride never exceeds `declared_trip_cost` remains strictly enforced server-side and displayed transparently to the passenger before confirmation.
- **Why:** Directly implements the SURVEY.md equal cost-splitting consensus, ensures exact mathematical sub-segment additivity using round-half-up math without clamping, and guarantees price immutability for existing bookings.
- **Evidence:** SURVEY.md §3 (variable table: pricing rule, 61%/67% support); P18 scope interview, 2026-11-19.
- **Source:** user · confidence high

---

## D-011 · MySQL-backed REST polling for chat and notifications
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Per-ride chat messages and in-app notifications are stored in MySQL tables and polled via REST GET endpoints authenticated with JWT. Chat room membership is strictly restricted: only the driver and passengers with bookings in `confirmed` or `pending_reconfirmation` status are authorized to read or post messages. The moment a passenger cancels, is rejected, transitions to `expired`, or their reconfirmation deadline lapses, their chat access is immediately revoked server-side (HTTP 403 Forbidden).
- **Why:** Keeps architecture simple and reliable without WebSocket state management, while strictly protecting passenger communication privacy.
- **Evidence:** P18 scope interview, 2026-11-19; suitable for local/academic demo context.
- **Source:** user · confidence high

---

## D-012 · Docker Compose full stack plus live URL deployment
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** The full stack (MySQL 8 + Express backend + React frontend) must start with a single `docker compose up` command for grading. The same codebase also supports `npm run dev` for local development with MySQL in Docker and the backend/frontend on the host. The app is additionally deployed to a live URL (Render / Railway / VPS) to satisfy the P18 Definition of Done (>= 5 real colleagues on the live instance).
- **Why:** Enables one-command local grading, fast local iteration, and fulfills the P18 Definition of Done (5 real colleagues on live).
- **Evidence:** P18 project sheet (Definition of Done); P18 scope interview, 2026-11-19.
- **Source:** user · confidence high

---

## D-013 · Password hashing with bcrypt and server-side RBAC checks
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Passwords must be hashed using `bcrypt` with a salt (work factor >= 10) before database persistence. Role-based access control (user, moderator, admin) is enforced server-side on every protected API endpoint, validating permissions from the verified JWT claims and verifying account status (e.g. active vs suspended) against the database.
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

---

## D-018 · Women-only ride preference and eligibility rule
- **Status:** approved
- **Date:** 2026-11-19
- **Confirmed:** 2026-11-19
- **Rule:** Users may optionally provide a private gender field (`female`, `male`, `prefer_not_to_say`) at registration, used strictly for women-only ride eligibility. Only accounts with `gender = female` are permitted to publish or book women-only rides (`prefer_not_to_say` and `male` cannot). Gender is self-declared and unverified. This feature is categorized as lowest priority (supported by 2 of 18 survey respondents) and will be the first feature cut if project deadlines require.
- **Why:** Enforces safety preference requested by female students in the survey while establishing clear eligibility boundaries and explicitly marking the feature as cut-first scope under schedule pressure.
- **Evidence:** SURVEY.md §4 (requirement 2: 2 of 18 free-text respondents); decision refinement, 2026-11-19.
- **Source:** user · confidence high
