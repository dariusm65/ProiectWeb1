# AI_LOG.md — P18 Student Carpooling

Log of AI-assisted sessions: what was asked, what was generated, and what was approved.

---

## Session 2026-11-19 — Scope interview and ledger bootstrap

### What was asked
The user asked the AI to interview them one question at a time (no code yet) until the full project scope could be written. Topics covered: tech stack, variables (routes, cancellation policy, search radius, segment pricing), roles, database, authentication, real-time, testing, deployment, screens (8 total), geocoding, recurring rides, stop-modification reconfirmation, out-of-scope items, seed data strategy, and the report system.

After the interview, the user asked for:
- `README.md` — scope, stack, variables from SURVEY.md
- `CONTEXT.md` — domain vocabulary with definitions
- `docs/agents/OPEN-QUESTIONS.md` — Q- entries for open points
- 11 PROPOSAL blocks (one per technical decision), then approval before writing to `DECISIONS.md`
- `AI_LOG.md` — this file
- `python3 docs/agents/tools/ledger-lint.py --fix` at the end

### What was generated
| File | Action | Contents |
|---|---|---|
| `README.md` | Created | Project scope, stack table, 10 survey routes + stops, cancellation policy, search radius, pricing rule, reconfirmation deadline rule, out-of-scope list, definition of done |
| `CONTEXT.md` | Replaced | 15 domain terms with definitions and _Avoid_ synonyms (platform domain + legacy lab terms) |
| `docs/agents/OPEN-QUESTIONS.md` | Updated | Q-001 closed (answered: P18); Q-002 added (university domain allowlist); Q-003 added (driver notification on deadline lapse) |
| `docs/agents/DECISIONS.md` | Replaced | D-001 (kept) + D-002 through D-012 added (11 new approved decisions) |
| `AI_LOG.md` | Created | This file |

### Q- answers provided in this session
| ID | Question | Answer |
|---|---|---|
| Q-1 (interview) | Reconfirmation deadline rule when stop modified | If > 2 h before departure: `min(now+6h, departure−2h)`. If ≤ 2 h: `min(now+30min, departure)`. -> Became D-007. |
| Q-2 (interview) | Can driver manually release pending_reconfirmation seat? | No — passenger must accept/decline or deadline lapses. -> Became D-007. |

### Decisions approved (2026-11-19)
| ID | Title |
|---|---|
| D-002 | Express REST API + OpenAPI documentation + React SPA |
| D-003 | MySQL 8 with mysql2 raw SQL and SELECT FOR UPDATE |
| D-004 | JWT authentication with university email domain allowlist |
| D-005 | Segment availability as a pure function tested with Vitest |
| D-006 | Recurring rides stored as rule + exceptions, materialised on demand |
| D-007 | Stop-edit triggers pending_reconfirmation with lazy deadline enforcement |
| D-008 | Ratings locked behind post-arrival server-side authorisation |
| D-009 | Nominatim/Photon geocoding with MySQL geocoding_cache |
| D-010 | Proportional segment pricing with declared trip cost cap |
| D-011 | MySQL-backed REST polling for chat and notifications |
| D-012 | Docker Compose full stack plus live URL deployment |

---

## Session 2026-11-19 (Part 2) — Technical decisions refinement and gap closure

### What was asked
The user requested an audit of 6 specific items across `README.md`, `PATTERNS.md`, `CONTEXT.md`, and `DECISIONS.md`, followed by proposals and approvals:
1. Realign D-001 with React + Vite and semantic HTML.
2. Amend D-003 to require versioned SQL migrations and an idempotent seed script running both locally and on live deployment.
3. Amend D-004 to explicitly state that university email verification is format/domain check only without inbox verification.
4. Amend D-005 to separate the pure function unit tests (8+ cases) from database integration tests for concurrency / `SELECT FOR UPDATE`.
5. Add decisions for:
   - D-013: Password hashing with bcrypt (salt factor >= 10) and server-side RBAC checks.
   - D-014: Server-side validation using Zod and React XSS prevention (no `dangerouslySetInnerHTML`).
   - D-015: GitHub Actions CI with MySQL service container.
   - D-016: Dual reputation model with seriousness score as a percentage (0%–100%, start 100%) computed on read from infraction events (−5 pp driver, −3 pp passenger, +1 pp per 7 clean days recovery), late cancellation penalties, and penalty fees outside the D-010 fare cap.
   - D-017: Search radius default 1 km up to 5 km.
6. Add Q-004 (live hosting platform) and Q-005 (unverified guesses for Timișoara and Bucharest student email domains).

### Changes recorded
- `docs/agents/DECISIONS.md`: updated D-001, D-003, D-004, D-005; added D-013 through D-017 (with D-016 recording the offline settlement and seat-refill known limitation).
- `docs/agents/OPEN-QUESTIONS.md`: added Q-004, Q-005, and answered Q-006 (passenger cancellation fee offline settlement and trip cost cap limitation).
- Run `python3 docs/agents/tools/ledger-lint.py --fix` (passed, 0 errors).

---

## Session 2026-11-19 (Part 3) — Booking lifecycle, pricing formula, women-only rule, and chat privacy

### What was asked & corrected by the user
The user audited the operational mechanics across all decisions and documentation, correcting several specific oversights:
1. **D-003 (Booking concurrency & selective auto-rejection):** Corrected the overbooking rule so that upon driver acceptance inside an InnoDB `SELECT FOR UPDATE` transaction, only competing pending requests traversing a leg whose capacity dropped to 0 are auto-rejected; competing requests on non-exhausted legs remain pending. Added passenger notifications for auto-rejection and expiration. Unanswered pending requests transition to `expired` at departure time (evaluated lazily on read, no cron).
2. **D-004 & D-018 (Registration & Women-Only segregation):** Removed all wording regarding "evaluation" or "grading" in favor of "so testers without a university address can still use the app". Split the women-only rule into its own decision (`D-018`) based on self-declared private gender (`female` required), marked explicitly as lowest priority and first to cut if schedule tightens.
3. **D-005 (Capacity counting):** Added `expired` to the list of non-capacity-consuming statuses and mandated tests for partial-overlap legs.
4. **D-007 (Driver notification idempotency):** Recorded that drivers receive an in-app notification when a passenger's reconfirmation deadline lapses, with lazy on-read creation being idempotent (created once per lapse). Marked Q-003 answered.
5. **D-010 (Cost splitting & pricing formula):** Established equal cost-sharing (`seat_full_price = declared_trip_cost / (available_seats + 1)`) and exact cumulative distance rounding (`segment_price(A, B) = round_half_up(cum(B)) - round_half_up(cum(A))` in integer lei, avoiding LaTeX syntax). Locked booking prices (`price_lei`) immutably upon creation.
6. **D-011 (Chat privacy):** Confined chat membership strictly to driver and passengers with `confirmed` or `pending_reconfirmation` bookings, immediately cutting access (403) upon cancellation, rejection, expiration, or lapse.
7. **Q-002 & Q-005:** Kept separate IDs to preserve references, narrowed allowlist to the 7 survey clusters (`@ulbsibiu.ro`, `@stud.ubbcluj.ro`, `@student.utcluj.ro`, `@student.upt.ro`, `@e-uvt.ro`, `@stud.acs.upb.ro`, `@unibuc.ro`).
8. **CONTEXT.md:** Defined `available_seats` (excluding driver) and added `expired` to booking statuses.

### Changes recorded
- `docs/agents/DECISIONS.md`: updated D-003, D-004, D-005, D-007, D-010, D-011; added D-018.
- `docs/agents/OPEN-QUESTIONS.md`: answered Q-003; refined Q-002 and Q-005.
- `CONTEXT.md`: added `available_seats` and `Women-only ride`; updated `Booking status` (`expired` added) and `University badge`.
- `README.md`: updated booking lifecycle, capacity/auto-rejection rules, pricing formula, chat privacy, and registration policies.
- Run `python3 docs/agents/tools/ledger-lint.py --fix` and verification check (passed, 0 errors).

---

## Session 2026-11-19 (Part 4) — DB schema, migrations and seed (/build, branch feat/db-schema-and-migrations)

### What the user corrected (three seed conditions)
1. Seed only places that appear in SURVEY.md (dropped Campus Hasdeu, Iulius Mall, Piata Romana, Politehnica, Calea Dumbravii from the plan). Coordinates only from a real Nominatim query, recorded with query + date; otherwise NULL with a marker.
2. System accounts use neutral addresses (admin@studride.local, moderator@studride.local), not a university domain.
3. No password or hash is committed: seed.js reads ADMIN_PASSWORD / MODERATOR_PASSWORD from .env and hashes them with bcrypt at runtime.

### What was done and what is NOT verified
- Tests written first; red run: 5 failed / 1 passed (files missing). After implementation: 6 static tests pass, 0 assertions changed (one code fix in seed.js to satisfy an existing assertion).
- Nominatim is not reachable from the sandbox, so ALL known_places coordinates are NULL (source = 'TODO-fill-from-Nominatim') for the owner to fill. Nothing was written from memory.
- Docker and MySQL are not installed here: the 10 integration tests (migration, 15 tables, seed idempotency, stop order 15, removed_at, UNIQUE instance_date) were SKIPPED, not passed. The SQL has never been executed against MySQL.

### Deviations from the approved plan (to confirm)
- known_places: latitude/longitude nullable; added source_query and queried_on columns.
- geocoding_cache is not pre-seeded (no coordinates to put in it).
- System accounts are inserted by seed.js (needs runtime bcrypt), not by the .sql seed file.
- bcryptjs (pure JS) instead of native bcrypt; same algorithm and hash format.
- MySQL DDL auto-commits, so migrations are not transactional; a version is recorded only after the file fully ran (files use IF NOT EXISTS).
- .env added to .gitignore (it was not ignored).

### Follow-up: Nominatim coordinates (same session)
- Added backend/database/fetch-nominatim.js (custom User-Agent, 1 req/s). Ran it outside the sandbox with the user's approval on 2026-11-19: 36/36 places found.
- Output goes to seeds/002_seed_known_place_coordinates.sql (UPDATE rows with source_query + queried_on), NOT into 001: the existing static test forbids coordinate literals in 001 and assertions may not be changed. 001 keeps the NULL/TODO marker.
- Review found one wrong match: plain query 'Boița, Romania' returned a Hunedoara hamlet; the survey route (Valea Oltului) needs the Sibiu county commune. Fixed with a query override ('Boița, Sibiu, Romania') and re-ran. Other ambiguous names (Vulcan, Zimbor, Vinga, Sântana, Câineni, Voiteg) match the survey routes' counties; each SQL row keeps Nominatim's display_name as a comment for review.
- NOT done: starting MySQL and running the 10 integration tests. No docker/podman/mysqld exists in this environment and I did not install one. A local untracked .env was created from .env.example (git-ignored).

---

## Session 2026-11-22 — PR #1 review fixes (branch feat/db-schema-and-migrations)

### Changes applied from parallel review (Performance, Security, SEO/GEO)
1. `docker-compose.yml`: bound MySQL port to `127.0.0.1` loopback only; moved healthcheck root password from CLI `-p` flag to `MYSQL_PWD` env var.
2. `backend/database/migrations/001_initial_schema.sql`:
   - Switched `ON DELETE CASCADE` to `ON DELETE RESTRICT` on `rides.driver_id`, `bookings.*`, `chat_messages.*`, `reviews.*`, and `user_infractions.user_id`; made `reports.reporter_id` nullable with `ON DELETE SET NULL`.
   - Added `CHECK` constraints (`available_seats >= 1`, `declared_trip_cost >= 0` on `rides` and `recurring_ride_rules`; `pickup_stop_id <> dropoff_stop_id`, `price_lei >= 0`, `cancellation_fee_lei IS NULL OR cancellation_fee_lei >= 0` on `bookings`; `reviewer_id <> reviewed_user_id` on `reviews`).
   - Promoted `(ride_id, stop_order)` on `ride_stops` and `(rule_id, stop_order)` on `recurring_rule_stops` to `UNIQUE KEY`.
   - Dropped redundant `idx_users_email` and `idx_known_places_city`; replaced separate ride status/departure indexes with composite `idx_rides_status_departure (status, departure_time)`; replaced `idx_bookings_status` with composite `idx_bookings_ride_status (ride_id, status)` and `idx_bookings_status_deadline (status, reconfirm_deadline)`.
3. `backend/src/db.js` & `backend/database/seed.js`: added `timezone: 'Z'`, `queueLimit: 50`, `enableKeepAlive: true`, `keepAliveInitialDelay: 10000` in `db.js`; wrapped `seed()` in a transaction and skipped `bcrypt.hash` when the system account already exists.
4. `backend/database/fetch-nominatim.js`: stripped newlines from `display_name` comments, escaped `\` before `'` in `sql()`, and validated coordinate bounds with `Number.isFinite`.
5. `docs/design/mocks/DS-004-search-results.html`: removed duplicate `display: flex;` on `#state-loading`; changed the Women-only ride driver to `Elena M.` (`EM`) to match `README.md`.
6. `docs/plans/db-schema-and-migrations.md`: replaced local `file:///` links with repo-relative links and added a "Post-build amendments" note at the top.

### Verification
- `python3 docs/agents/tools/ledger-lint.py`: passed (`✓ ledger ok`).
- `npm test --prefix backend`: 6/6 static tests passed, 0 test assertions modified; 10 MySQL integration tests skipped here (no Docker/MySQL in sandbox — re-run locally against Docker MySQL before merging).
- `node --check` on `db.js`, `seed.js`, `fetch-nominatim.js`: passed.

---

## Session 2026-11-22 — Visual direction overhaul (`DESIGN.md` & `DS-001`–`DS-004` mocks)

### What was asked
1. **Step 1:** Update `docs/design/DESIGN.md` to replace the sterile slate/teal/cyan palette and monospace typography with the approved Warm Cream (`#F5EFE6`) & Deep Forest Green (`#143D2B`) Light Mode, Neutral Charcoal (`#0E100F`) & Forest Green (`#1F6B47`) Dark Mode, `Fraunces` display typography (`-0.02em`), and `DM Sans` (`tabular-nums`) UI/numeric typography, while preserving all StudRide domain invariants and `DS-001`–`DS-004` specs.
2. **Step 2 (after user confirmation):** Create/update all 4 HTML mocks (`DS-001` through `DS-004`) in `docs/design/mocks/` strictly implementing `DESIGN.md`, run `ledger-lint.py`, and update `AI_LOG.md`.

### Changes recorded
| File | Action | Contents |
|---|---|---|
| `docs/design/DESIGN.md` | Updated | Warm Cream / Deep Forest Green light tokens, Neutral Charcoal / Forest Green dark tokens, `Fraunces` + `DM Sans` (`tabular-nums`) typography (zero monospace), exact `38×38px` (`rx="10"`) SVG brand mark spec, domain invariants, and `DS-001`–`DS-004` specs |
| `docs/design/mocks/DS-001-tokens-brand.html` | Created | Brand lockup (light & dark), full color swatch boards, `Fraunces` + `DM Sans` (`tabular-nums`) specimens, domain badge primitives, working Light/Dark toggle |
| `docs/design/mocks/DS-002-landing-search.html` | Created | Editorial split hero with Carpathian forest road SVG illustration, integrated search card (`1 km (Implicit)`, `3 km`, `5 km` chips per `D-017`), popular Romanian corridors, toggleable `default` / `loading` / `error` states |
| `docs/design/mocks/DS-003-auth.html` | Created | Tabbed Login & Register card with live Romanian university domain validator (`Validat pe domeniu (nu identitate verificată)` per `D-004`), optional private gender selector (`D-018`), toggleable `default` / `loading` / `error` / `success` states |
| `docs/design/mocks/DS-004-search-results.html` | Updated | Travel-ticket ride cards with horizontal route arc, expandable intermediate stops (`D-005`), perforated right-hand stub (`lei` + `Rezervă segment`, 1 seat/passenger per `D-019`), female driver `Women-only` ride (`D-018`), `Anulare recentă` dual reputation (`D-016`), 6-stop `Bacău → București` route, synced sticky topographic Romania map (`D-009` cache badge) + `D-010` fuel split box, and all 4 toggleable states (`success`, `loading`, `empty`, `error`) |
| `AI_LOG.md` | Updated | Logged 2026-11-22 design tokens and `DS-001`–`DS-004` mock implementation session |

- Run `python3 docs/agents/tools/ledger-lint.py` (passed, 0 errors).

### Brand mark & route node marker refinement (2026-11-22)
- Removed all mustard/amber yellow (`#C88228`, `#E5A94C`, `var(--color-accent)`) from the `38×38px` (`rx="10"`) StudRide SVG brand mark and from all route origin/destination/intermediate stop markers across `docs/design/DESIGN.md` and `DS-001`–`DS-004`.
- Brand mark uses Deep Forest Green (`#143D2B` light / `#1F6B47` dark), Warm Cream (`#FCF9F4`) for the graduation cap & tassel, and soft Sage Mint (`#9AD6B6`) + Warm Cream (`#FCF9F4`) for the curved 3-stop dotted route line and stop markers.
- Route origin & destination markers (timelines, route arcs, topographic map pins, and hero road stops) now use a Forest Green & Soft Sage double-ring (`#143D2B` + `#B7DEC9` light / `#34A86B` + `rgba(52, 168, 107, 0.28)` dark), with muted intermediate stop dots (`#5E7368` light / `#8C9992` dark).
- Scoped Warm Amber (`#C88228` / `#E5A94C`) strictly to driver star ratings (`★`) and subtle decorative warmth, never on route nodes or the logo.

---

## Session 2026-11-22 (Part 2) — Slice 2: Core Business Logic (`feat/segment-core-logic`)

### What was planned & built
1. **Pure Segment Availability (`backend/src/domain/segmentAvailability.js`):** Half-open `stop_order` interval overlap (`[pickupOrder, dropoffOrder)` against active segments), soft-removed stop resolution (`removed_at IS NOT NULL`), capacity counting restricted to `confirmed` + `pending_reconfirmation` (`D-005`, `D-019`), and selective competing `pending` booking partitioning (`D-003`).
2. **Pure Proportional Segment Pricing & Reconfirmation Deadline (`backend/src/domain/segmentPricing.js`):** Exact `BigInt` rational `round_half_up` implementation of `D-010`, `validateTripCostCap` (summing only `confirmed` + `pending_reconfirmation`), and `computeReconfirmDeadline` (`D-007`).
3. **Transactional Booking Acceptance (`backend/src/services/bookingAcceptanceService.js`):** Raw SQL (`mysql2/promise`) InnoDB transaction with canonical `SELECT ... FOR UPDATE` lock order (`rides` → `ride_stops` → `bookings`), lazy expiry (`pending -> expired` at departure) and lazy lapse (`pending_reconfirmation -> expired` past `reconfirm_deadline`) with idempotent notifications (`notifications.idempotency_key`), guards (`ride.status === 'active'`, driver ownership, non-removed pickup/dropoff stops, `D-010` cost cap), and selective auto-rejection of saturated competing `pending` bookings.
4. **Tests (written first — TDD):**
   - `backend/tests/domain.test.js` (15 deterministic unit tests covering all `D-005`, `D-010`, and `D-007` behaviors).
   - `backend/tests/bookingAcceptance.test.js` (4 MySQL integration tests on dedicated throwaway DB `studride_test_bookings`: 2-connection `Promise.all` concurrency, selective auto-rejection, lazy lapse + idempotent driver notification, and acceptance guards).

### Verification
- Red run confirmed `domain.test.js` failed on missing modules; green run: **21 passed | 14 skipped (35)** (`15/15` `domain.test.js` + `6/6` static `database.test.js`; `10` DB + `4` bookingAcceptance MySQL integration tests skipped here because MySQL is unreachable in sandbox — to be verified locally against `docker compose up -d`).
- `0` test assertions modified; `python3 docs/agents/tools/ledger-lint.py` passed (`✓ ledger ok`).

### 3-Specialist Parallel Review & Fixes (2026-11-22)
Parallel read-only review (Performance & SQL Specialist, Security & Invariant Engineer, Domain & Edge-Case Auditor) surfaced 7 issues, all fixed on `feat/segment-core-logic`:
1. **Persisted lazy reconciliation on domain errors:** Committed `reconcileRideBookings` updates/notifications before rethrowing `BookingDomainError` so departure-time expirations and `pending_reconfirmation` lapses are never rolled back.
2. **Authorization & `D-019` guards:** Added `users.is_suspended` checks for driver & passenger (`D-013`, `D-016`), self-booking guard, and duplicate active booking guard per passenger per ride (`D-019`).
3. **Strict `D-003` selective rejection:** Restricted `findCompetingPendingBookingsToReject` to segments whose capacity *just* dropped from `> 0` to `0` (`pre.freeSeats > 0 && post.freeSeats === 0`).
4. **SQL batching & index alignment:** Replaced N+1 loops with batched `UPDATE ... WHERE id IN (?)` and multi-row `INSERT INTO notifications (...) VALUES ? ON DUPLICATE KEY UPDATE id = id`; dropped `ORDER BY id ASC` from the locked `bookings` query (sorting in JS).
5. **Input validation & edge cases:** Normalized/validated positive integer IDs (`rideId`, `bookingId`, `driverId`), validated active `b.price_lei` in `validateTripCostCap`, allowed `pickupDistKm === dropoffDistKm` (`0` lei), rejected numeric `declaredTripCost` with `> 2` decimal places, and guarded soft-removed stops in `getAvailableSeatsForRange`.
6. **Regression tests:** Added unit tests (`domain.test.js`: 18 passing) and MySQL integration tests (`bookingAcceptance.test.js`: 6 integration tests including error-code concurrency check, persisted departure-time expiry, and suspended/self/duplicate guards).

---

## Session 2026-11-22 (Part 3) — Slice 3: Express API Foundation, Auth (JWT + RBAC), OpenAPI & CI (`feat/express-auth-ci`)

### What was planned & built
1. **Ledger updates (`Q-002`, `Q-005`):** Marked `Q-002` and `Q-005` as `answered` in `docs/agents/OPEN-QUESTIONS.md` with the accredited Romanian university root + subdomain + `EXTRA_UNIVERSITY_DOMAINS` rule (`D-004`).
2. **Express API & Middleware (`D-002`, `D-013`, `D-014`):** Added `express`, `cors`, `helmet`, `zod`, `jsonwebtoken`, `swagger-ui-express`, and devDependency `supertest`. Built `backend/src/app.js` (injectable `pool` factory), `backend/src/server.js` (startup `migrate()`/`seed()` + graceful shutdown), `backend/src/middleware/validate.js` (Zod), `backend/src/middleware/errorHandler.js`, `GET /api/health` (`200 { status: 'ok', db: 'up' }` / `503`), and OpenAPI 3.0 spec at `GET /api/openapi.json` & `GET /api/docs`.
3. **Auth, University Domain Allowlist & Live-DB RBAC (`D-004`, `D-013`, `D-018`):** Built `backend/src/domain/universityDomains.js`, `backend/src/middleware/auth.js` (`signAccessToken`, `requireAuth` verifying live DB `role` & `is_suspended`, `requireRole`), and `backend/src/routes/auth.js` (`POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` with `bcryptjs` cost 10, `university_badge_note: "domain-validated (not identity-verified)"`, and optional `gender`).
4. **GitHub Actions CI (`D-015`):** Created `.github/workflows/ci.yml` with MySQL 8.0 service container running `npm test --prefix backend` and `python3 docs/agents/tools/ledger-lint.py` on `push` to `main` and `pull_request`.
5. **Tests (TDD):** Added `backend/tests/universityDomains.test.js` (5 unit tests) and `backend/tests/auth.test.js` (6 Supertest + MySQL integration tests on `studride_test_auth`).

### Verification
- TDD red run confirmed `universityDomains.test.js` failed on missing module; green run: **29 passed | 22 skipped (51)** (`5/5` `universityDomains.test.js`, `18/18` `domain.test.js`, `6/6` static `database.test.js`; `22` MySQL integration tests skipped in sandbox due to `ECONNREFUSED`).
- `0` test assertions changed; `node --check` passed on all 7 new backend modules; `python3 docs/agents/tools/ledger-lint.py --fix` & `ledger-lint.py` passed (`✓ ledger ok`).

### 3-Specialist Parallel Review & Fixes (Slice 3)
Parallel read-only review (Performance & SQL Specialist, Security & Invariant Engineer, Domain & Edge-Case Auditor) surfaced 6 issues, all fixed on `feat/express-auth-ci`:
1. **Express 5 `validateQuery` crash (`D-014`):** Redefined `req.query` via `Object.defineProperty` in `backend/src/middleware/validate.js` and added Supertest regression test (`backend/tests/validate.test.js`).
2. **Strict DNS label regex:** Replaced loose domain regex in `backend/src/domain/universityDomains.js` with `/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/` and added edge-case tests rejecting leading/consecutive dots, hyphen-bounded labels, and malformed `EXTRA_UNIVERSITY_DOMAINS`.
3. **Complete `D-004` badge disclosure:** Updated `UNIVERSITY_BADGE_NOTE` and `openapi.js` to `'domain-validated (not identity-verified; mailbox ownership unverified)'` and returned `null` when `!row.university_domain`.
4. **Security hardening:** Raised `JWT_SECRET` floor to `>= 32` UTF-8 bytes in `app.js`, defaulted `corsOrigin` to `false` (fail closed), enforced `<= 72` UTF-8 bytes on bcrypt passwords in Zod (`routes/auth.js`), added `permissions: { contents: read }` and passwordless `mysqladmin ping` healthcheck in `.github/workflows/ci.yml`.
5. **Server lifecycle robustness:** Added `shuttingDown` guard, `try/catch` around `pool.end()`, `server.closeIdleConnections?.()`, `server.on('error', ...)` cleanup, and a loud startup warning if `ADMIN_PASSWORD`/`MODERATOR_PASSWORD` are unset in `server.js`.
6. **Test & CI robustness:** Wrapped `migrateConn` in `try/finally` in `auth.test.js` and made `database.test.js`, `bookingAcceptance.test.js`, and `auth.test.js` fail loudly when `process.env.CI` is set and MySQL is unreachable.

---

## Session 2026-11-23 — Slice 4A: Geocoding Cache, Rides Publishing, Spatial Segment Search & Recurring Rides (`feat/rides-search-geocoding`)

### What was planned & built
1. **Ledger & Architecture updates (`D-020`, `C-001`, `PATTERN-002`, `PATTERN-003`):**
   - Recorded `D-020` (UTC storage in MySQL `DATETIME` with `Europe/Bucharest` wall-clock interpretation via native `Intl` for recurring ride `departure_time`, search `date`, and `D-016` same-day cancellation checks) in `docs/agents/DECISIONS.md`.
   - Recorded `C-001` (OpenStreetMap Nominatim usage policy: custom `User-Agent`, `<= 1` req/sec outbound throttling, MySQL cache persistence, zero throttling on cache hits or test mocks) in `docs/agents/CONTRACTS.md`.
   - Recorded candidate patterns `PATTERN-002` (isolated throwaway MySQL DB per integration test file) and `PATTERN-003` (injectable `fetchFn` and `nowFn`) in `docs/agents/PATTERNS.md`, and refreshed `docs/agents/ARCHITECTURE.md`.
2. **Pure Domain Modules (`D-006`, `D-016`, `D-017`, `D-020`):**
   - `backend/src/domain/geo.js`: `haversineKm` and `boundingBox` (SQL prefilter on `idx_stops_coords` before exact Haversine evaluation).
   - `backend/src/domain/recurrence.js`: `dayOfWeekName`, `ruleAppliesOn`, `bucharestLocalToUtc`, `bucharestDateOf`, `bucharestDayBounds`, and `buildInstanceTimes` (DST-aware `Europe/Bucharest` conversion using native `Intl.DateTimeFormat`).
   - `backend/src/domain/seriousnessScore.js`: `computeSeriousnessScore` (event-sourced replay from 100% with `-5` / `-3` penalties, `[0, 100]` clamping, and `+1` recovery per full 7 clean days), `isPublishingBanned` (7-day `driver_late_cancel` ban), and `isWithinLateCancelWindow`.
3. **Services & Express Routes (`D-003`, `D-005`, `D-006`, `D-009`, `D-010`, `D-014`, `D-016`, `D-017`, `D-018`):**
   - `backend/src/errors.js`: `ApiError(statusCode, code, message)` for clean 4xx/502 error handling.
   - `backend/src/services/geocodingService.js` & `backend/src/routes/geocoding.js`: `GET /api/geocoding/search` (`geocoding_cache` → `known_places` → Nominatim) and `GET /api/geocoding/reverse` (4-decimal rounded coords → `geocoding_cache` → Nominatim) with SHA-256 `query_hash` (`fwd:` / `rev:` namespace), injectable `fetchFn`, and outbound-only throttling (`C-001`).
   - `backend/src/services/rideService.js` & `backend/src/routes/rides.js`: `POST /api/rides` (Zod validation, server-assigned `stop_order` 10, 20, 30..., `D-018` `women_only` guard, `D-016` 7-day publishing ban guard), `GET /api/rides/:rideId` (public ride details, ordered active stops, per-segment availability + `D-010` proportional prices, driver summary with live `D-016` seriousness score and `D-004` badge note, safe confirmed passengers list), and `GET /api/rides` (spatial segment search with default `1 km` / max `5 km` radius per `D-017`, filters, lazy per-ride reconciliation in sorted short transactions, `free_seats >= 1`, and `segment_price_lei`).
   - `backend/src/services/recurringRideService.js` & `backend/src/routes/recurringRides.js`: `POST /api/recurring-rides`, `POST /api/recurring-rides/:ruleId/exceptions` (cancels concrete ride instance and all `pending`, `confirmed`, and `pending_reconfirmation` bookings, sends idempotent notifications, and records a `driver_late_cancel` infraction if seat-holding passengers exist within the same-day departure window), and on-demand materialisation (`INSERT IGNORE INTO rides` on `uq_rule_instance`, inserting `ride_stops` only when `affectedRows === 1`, skipping exception dates, suspended drivers, and 7-day-banned drivers).
   - Wired routers in `backend/src/app.js` and documented all 6 endpoints and schemas in `backend/src/openapi.js`.
4. **Tests (TDD):**
   - `backend/tests/geo.test.js` (8 unit tests), `backend/tests/recurrence.test.js` (12 unit tests), `backend/tests/seriousnessScore.test.js` (13 unit tests), and `backend/tests/rides.test.js` (32 Supertest + MySQL integration tests on `studride_test_rides`).

### Verification
- TDD red run confirmed `geo.test.js`, `recurrence.test.js`, and `seriousnessScore.test.js` failed on missing modules (`8ea8635`).
- Green run (`npm test --prefix backend`): **65 passed | 56 skipped (121)** in sandbox (`8/8` `geo.test.js`, `12/12` `recurrence.test.js`, `13/13` `seriousnessScore.test.js`, `18/18` `domain.test.js`, `5/5` `universityDomains.test.js`, `3/3` `validate.test.js`, `6/6` static `database.test.js`); full local Docker MySQL 8 run passed **100%** (0 skipped) after passing through explicit `ApiError` 5xx responses (`502 GEOCODING_UNAVAILABLE`) in `backend/src/middleware/errorHandler.js` (`06e9f49`).
- `python3 docs/agents/tools/ledger-lint.py --fix` and `python3 docs/agents/tools/ledger-lint.py`: passed (`✓ ledger ok`).

### 3-Specialist Parallel Review & Fixes (Slice 4A)
Parallel read-only review (Performance & SQL Specialist, Security & Invariant Engineer, Domain & Edge-Case Auditor) verified transaction boundaries, `FOR SHARE`/`FOR UPDATE` + `INSERT IGNORE` concurrency locking, spatial index usage, auth/RBAC/PII boundaries, Zod coercion guards, and `C-001` Nominatim throttling, and surfaced 4 domain/edge-case findings, all fixed on `feat/rides-search-geocoding`:
1. **`searchRides` best available stop pair within `radiusKm` (`backend/src/services/rideService.js`):** Replaced single pre-availability `bestStopPair` selection with distance-ordered `candidateStopPairs`, choosing the closest `(pickup, dropoff)` pair within `radiusKm` that has `getAvailableSeatsForRange(...) >= 1` after lazy reconciliation (plus integration regression test in `rides.test.js`).
2. **Lazy reconciliation before `addException` cancellation (`backend/src/services/recurringRideService.js`):** Invoked `reconcileRideBookings(conn, { rideId: ride.id, ride, now })` inside the `addException` transaction before inspecting/cancelling bookings so an overdue `pending_reconfirmation` (`reconfirm_deadline <= now` per `D-007`) lapses to `expired` first and never falsely triggers a `driver_late_cancel` infraction (`D-016`) (plus integration regression test in `rides.test.js`).
3. **OpenAPI `RecurringRule` & `RuleStop` schemas (`backend/src/openapi.js`):** Added the 6 `RideOptions` fields (`available_seats`, `declared_trip_cost`, `luggage_allowed`, `pets_allowed`, `smoking_allowed`, `women_only`) to `RecurringRule.properties.rule` and added `RuleStop` (with `stop_order`) for `RecurringRule.properties.stops`.
4. **Europe/Bucharest spring-forward DST gap (`backend/src/domain/recurrence.js`):** Updated `bucharestLocalToUtc` so non-existent spring-forward wall-clock times (e.g. `03:30` on the last Sunday of March) resolve forward (`04:30` EEST / `01:30Z`) rather than stepping backward (`02:30` EET / `00:30Z`) (plus unit test in `recurrence.test.js`).

---

## Session 2026-11-23 (Part 2) — Slice 4B: Bookings Lifecycle, Driver Stop Editing (`D-007`), and Cancellations / Infractions (`D-016`) (`feat/bookings-stop-edits-cancellations`)

### What was planned & built
1. **Ledger & Architecture updates (`PATTERN-002`, `PATTERN-003`):**
   - Marked `PATTERN-002` and `PATTERN-003` as `Confirmed: 2026-11-23` in `docs/agents/PATTERNS.md`.
   - Updated `docs/agents/ARCHITECTURE.md` with `bookingService.js`, `routes/bookings.js`, and the new ride booking/stop-edit/cancel endpoints.
2. **Pure Domain Helpers (`backend/src/domain/seriousnessScore.js`, `D-016`):**
   - `isWithinPassengerLateCancelWindow`: strictly `< 4 hours` before departure (`0 < departureTime - now < 4h`).
   - `calculatePassengerCancellationFee`: 50% of booked segment `price_lei` with exact round-half-up, capped at `20` lei.
   - `hasRecentCancellationBadge`: `true` if a `driver_late_cancel` infraction occurred within the last 30 days (`"Anulare recentă"` badge).
3. **Transactional Booking Lifecycle (`backend/src/services/bookingService.js`, `bookingAcceptanceService.js`, `routes/bookings.js`, `routes/rides.js`):**
   - `POST /api/rides/:rideId/bookings`: locks `rides` -> `ride_stops` -> `bookings` (`FOR UPDATE`), runs `reconcileRideBookings`, enforces active future ride, blocks driver self-booking (`403 SELF_BOOKING_NOT_ALLOWED`), enforces `D-018` `women_only` (`403 WOMEN_ONLY_NOT_ALLOWED`), validates active ordered pickup/dropoff stops (`pickup.stop_order < dropoff.stop_order`), prevents duplicate non-terminal booking on the same ride (`409 DUPLICATE_ACTIVE_BOOKING`, `D-019`), verifies `>= 1` free seat (`D-005`) and `D-010` trip cost cap, locks `price_lei`, sets computed `expires_at = ride.departure_time` (`D-003`), and inserts idempotent driver notification `booking_requested:${bookingId}` (`D-011`).
   - `POST /api/bookings/:bookingId/accept`: wires `acceptBooking` (`SELECT FOR UPDATE` + lazy reconciliation + `D-003` selective competing auto-rejection) and adds idempotent passenger notification `booking_accepted:${bookingId}`.
   - `POST /api/bookings/:bookingId/reject`: rejects a `pending` booking inside a `FOR UPDATE` transaction after lazy reconciliation and sends idempotent notification `booking_rejected:${bookingId}`.
   - `GET /api/bookings/me` and `GET /api/rides/:rideId/bookings`: run `reconcileRidesLazily` first and return enriched booking payloads.
4. **Driver Stop / Schedule Editing & Passenger Reconfirmation (`backend/src/services/rideService.js`, `bookingService.js`, `D-007`, `D-010`, `D-011`):**
   - `PATCH / PUT /api/rides/:rideId/stops`: edits, inserts, and soft-removes stops inside a `FOR UPDATE` transaction after `reconcileRideBookings`. Preserves positive monotonic `stop_order` on soft-removed stops (`removed_at IS NOT NULL`) between active multiples-of-10 stops so `pending_reconfirmation` bookings referencing removed stops continue to reserve segment capacity in `segmentAvailability.js`. Keeps existing bookings' locked `price_lei` immutable (`D-007`, `D-010`), transitions affected `confirmed` bookings to `pending_reconfirmation` with `computeReconfirmDeadline` and idempotent notifications, and auto-rejects `pending` bookings referencing removed stops.
   - `POST /api/bookings/:bookingId/reconfirm`: blocks reconfirmation with `409 STOP_REMOVED` if the booking's own pickup or dropoff stop was soft-removed, lazily lapses overdue bookings (`409 BOOKING_NOT_PENDING_RECONFIRMATION`), and restores on-time bookings to `confirmed` with idempotent driver notification `booking_reconfirmed:${bookingId}`.
5. **Cancellations, Seriousness Infractions & 30-Day Badge (`D-016`, `D-011`, `D-020`):**
   - `POST /api/bookings/:bookingId/cancel`: cancels a passenger's non-terminal booking; records `passenger_late_cancel` (`-3` pp) and `cancellation_fee_lei` (`50%` capped at `20` lei) only when cancelling a `confirmed` booking `< 4h` before departure (`pending` and `pending_reconfirmation` are exempt).
   - `POST /api/rides/:rideId/cancel`: cancels an active future ride and all non-terminal bookings after `reconcileRideBookings`, notifies affected passengers idempotently, and records `driver_late_cancel` (`-5` pp) when seat-holding passengers exist on the `Europe/Bucharest` departure day.
   - Exposed `has_recent_cancellation_badge` on driver summaries in `GET /api/rides/:rideId` and `GET /api/rides`, and documented all 9 new endpoints and schemas in `backend/src/openapi.js`.
6. **Tests (TDD):**
   - `backend/tests/seriousnessScore.test.js` (6 new unit tests, 19 total).
   - `backend/tests/bookings.test.js` (9 Supertest + MySQL integration tests on dedicated throwaway DB `studride_test_bookings_api`).

### 3-Specialist Parallel Review & Fixes (Slice 4B)
Parallel read-only review (Performance & SQL Specialist, Security & Invariant Engineer, Domain & Edge-Case Auditor) verified canonical lock ordering (`rides` -> `ride_stops` -> `bookings` `FOR UPDATE`), commit-on-lazy-expiry, `D-013` auth/ownership boundaries, `D-018` `women_only` guards, `D-019` single-seat & duplicate active booking prevention, `D-016` infraction & fee conditions, and `openapi.js` accuracy across all 9 endpoints, and surfaced 3 multi-edit edge cases plus 1 rollback wrapper improvement, all fixed on `feat/bookings-stop-edits-cancellations`:
1. **Consecutive stop edits while already in `pending_reconfirmation` (`backend/src/services/rideService.js`):** Updated `editRideStops` to also re-evaluate existing `pending_reconfirmation` bookings when a second stop edit touches their route or changes `departure_time`, updating `reconfirm_deadline` via `computeReconfirmDeadline` and notifying the passenger.
2. **Capacity preservation when leading stops are soft-removed (`backend/src/services/rideService.js`):** Anchored soft-removed stops inside the active stop intervals using both surviving stop order bounds and `distance_from_origin_km` (clamped at index `0` so removed origin/leading stops sit inside the first active segment `[10, 20)` rather than `< 10`), ensuring `computeSegmentAvailability` continues to reserve the seat until `reconfirm_deadline` lapses.
3. **Notification keys across repeated edit/reconfirm cycles (`backend/src/services/rideService.js`, `backend/src/services/bookingService.js`):** Included `nowIso` in `stop_edit_reconfirm` keys and sequence suffixing on subsequent `booking_reconfirmed` notifications so repeated edit -> reconfirm -> edit -> reconfirm cycles never drop notifications on `ON DUPLICATE KEY UPDATE`.
4. **Defensive rollback wrapper (`backend/src/services/bookingAcceptanceService.js`):** Wrapped `await conn.rollback()` in `try/catch` to match `finishTx`.

---

## Session 2026-11-23 (Part 3) — Slice 5: Ride Chat, Notifications (`D-011`), Post-Arrival Mutual Ratings (`D-008`), and Moderation / Admin Suspension Cascade (`D-013`, `D-016`) (`feat/chat-notifications-reviews-moderation`)

### What was planned & built
1. **Ledger & Architecture updates (`PATTERN-002`, `PATTERN-003`):**
   - Promoted `PATTERN-002` (isolated throwaway MySQL DB per integration test file) and `PATTERN-003` (injectable `fetchFn` and `nowFn`) from `candidate` to `approved` in `docs/agents/PATTERNS.md`.
   - Updated `docs/agents/ARCHITECTURE.md` with the new Slice 5 services and routers.
2. **Ride Chat Messages (`backend/src/services/chatService.js`, `backend/src/routes/rides.js`, `D-011`, `D-013`, `D-014`):**
   - `GET /api/rides/:rideId/messages` and `POST /api/rides/:rideId/messages`: runs `reconcileRidesLazily` first so overdue `pending_reconfirmation` or `pending` bookings transition to `expired` before checking membership.
   - Enforces strict `D-011` participant membership (`isAuthorizedChatParticipant`: only the ride's driver and passengers with `confirmed` or `pending_reconfirmation` bookings; `403 FORBIDDEN` for `pending`, `cancelled`, `rejected`, `expired`, or outsiders).
   - Orders messages deterministically by `created_at ASC, id ASC`, returns safe sender summary (omitting `email`, `phone`, `gender`, `password_hash`), blocks posting to cancelled rides (`409 RIDE_NOT_ACTIVE`) while allowing the driver to read history, and fans out idempotent `chat_message` notifications to all other active chat participants.
3. **Notifications Polling & Read State (`backend/src/services/notificationService.js`, `backend/src/routes/notifications.js`, `D-011`, `D-013`, `D-014`):**
   - `GET /api/notifications`: reconciles lazy expirations/lapses on caller's rides first, supports `?unreadOnly=true|false`, and returns `{ notifications, unread_count }` ordered `created_at DESC, id DESC`.
   - `PATCH /api/notifications/:notificationId/read` (owner-checked, sets `is_read = TRUE`) and `POST /api/notifications/read-all` (marks all caller notifications `is_read = TRUE`).
4. **Post-Arrival Mutual Star Ratings & Public Reputation (`backend/src/services/reviewService.js`, `backend/src/routes/rides.js`, `backend/src/routes/users.js`, `D-008`, `D-013`, `D-014`, `D-016`):**
   - `POST /api/rides/:rideId/reviews`: reconciles lazy expirations/lapses first, blocks cancelled rides (`409 RIDE_CANCELLED`), locks submissions until `estimated_arrival_time <= now` (`403 REVIEW_BEFORE_ARRIVAL`), blocks self-reviews (`400 SELF_REVIEW_NOT_ALLOWED`), enforces mutual direction strictly between the driver and a `confirmed` passenger on that ride (`403 NOT_CONFIRMED_PARTICIPANT`), enforces 1 review per `(ride_id, reviewer_id, reviewed_user_id)` (`409 DUPLICATE_REVIEW`), and notifies the reviewed user.
   - `GET /api/users/:userId/reviews` (and `GET /api/users/:userId`): public endpoint returning `{ user, reviews }` with dual reputation metrics (`rating_average`, `rating_count`, `seriousness_score`, `has_university_badge`, `university_badge_note`, `has_recent_cancellation_badge`) and zero PII.
5. **Moderation Reports & Transactional Admin Suspension Cascade (`backend/src/services/moderationService.js`, `backend/src/routes/reports.js`, `backend/src/routes/admin.js`, `D-013`, `D-016`):**
   - `POST /api/reports`: requires at least one of `reported_user_id`, `ride_id`, or `message_id`, blocks self-reporting (`400`), and verifies referenced entities exist (`404`).
   - `GET /api/admin/reports` & `PATCH /api/admin/reports/:reportId` (`moderator`, `admin`).
   - `GET /api/admin/users` (`moderator`, `admin`): lists users with email, seriousness scores, infraction counts, star ratings, and suspension status (`password_hash` omitted).
   - `POST /api/admin/users/:userId/suspend` & `POST /api/admin/users/:userId/unsuspend` (`moderator`, `admin`): enforces role hierarchy (`canModerateTargetUser`), locks affected active future rides in ascending `ride.id` order (`FOR UPDATE`), calls `reconcileRideBookings` before cancelling non-terminal bookings, cancels upcoming published rides (notifying passengers), cancels upcoming passenger bookings (freeing segment seats and notifying drivers), and assesses **zero** `user_infractions` or `cancellation_fee_lei` (`D-016`).
   - `POST /api/admin/rides/:rideId/cancel` (`moderator`, `admin`), `PATCH /api/admin/users/:userId/role` (`admin` only), and `GET /api/admin/stats` (`admin` only).
   - Documented all new endpoints and schemas in `backend/src/openapi.js`.
6. **Tests (TDD):**
   - `backend/tests/communityModeration.test.js`: 4 pure unit tests + 4 comprehensive Supertest + MySQL integration tests on isolated throwaway DB `studride_test_community_mod`.

### 3-Specialist Parallel Review & Fixes (Slice 5)
Parallel read-only review (Performance & SQL Specialist, Security & Invariant Engineer, Domain & Edge-Case Auditor) verified canonical lock ordering (`users` -> ascending `ride.id` `rides` -> `bookings` `FOR UPDATE`), `reconcileRideBookings` execution before cascade cancellations, strict `D-011` chat membership & immediate `403` revocation, `D-008` post-arrival mutual ratings, `D-016` zero infractions/fees on moderation suspension cascade, `D-013` live-DB RBAC, `D-014` Zod validation, and strict PII boundaries, and surfaced 4 findings, all fixed on `feat/chat-notifications-reviews-moderation`:
1. **`moderateCancelRide` past-ride guard & commit-on-lazy-expiry (`backend/src/services/moderationService.js`):** Blocked cancelling rides that have already departed (`new Date(ride.departure_time).getTime() <= now.getTime()` -> `409 RIDE_ALREADY_DEPARTED`) so completed historical trips cannot be retroactively cancelled to lock out `D-008` post-arrival ratings, and committed `reconcileRideBookings` lazy expirations/lapses before rethrowing `ApiError` (`hasReconciledChanges && !hasMutatedTarget`).
2. **Indirect self-report & cross-entity mismatch guards in `createReport` (`backend/src/services/moderationService.js`):** Checked `ride.driver_id === user.id` (when reporting a ride directly) and `message.sender_id === user.id` (`400 SELF_REPORT_NOT_ALLOWED`), and verified `message.ride_id === ride_id` (`400 REPORT_TARGET_MISMATCH`) when both `ride_id` and `message_id` are supplied.
3. **Defense-in-depth & repeat-call notification idempotency (`backend/src/services/moderationService.js`):** Explicitly rejected non-moderator/non-admin actors in `canModerateTargetUser` (`403 FORBIDDEN`) and emitted `account_suspended` / `account_unsuspended` notifications only when `target.is_suspended` actually transitions (`false -> true` or `true -> false`).
4. **OpenAPI spec alignment (`backend/src/openapi.js`):** Added `minLength: 1` to `reason` on `POST /api/admin/users/{userId}/suspend` and `POST /api/admin/rides/{rideId}/cancel`, and documented `400` responses for invalid path parameters on `PATCH /api/notifications/{notificationId}/read` and `POST /api/admin/rides/{rideId}/cancel`.

---

## Session 2026-11-23 (Part 4) — Slice 6: Frontend Foundation, Auth, Ride Search & Details, and Publish Ride (Single & Recurring) (`feat/frontend-foundation-search-publish`)

### What was planned & built
1. **Design Mocks, Registry & Ledger (`DS-005`, `DS-006`, `DS-010`, `PATTERN-001`):**
   - Created HTML mocks `docs/design/mocks/DS-005-ride-details.html`, `docs/design/mocks/DS-006-publish-ride.html`, and `docs/design/mocks/DS-010-public-profile.html` following the Warm Cream / Deep Forest Green light tokens and Neutral Charcoal / Forest Green dark tokens (`DS-001`).
   - Updated `docs/design/DESIGN.md` and `docs/design/registry.yaml` (`DS-001`–`DS-006`, `DS-010` marked `implemented`), and marked `PATTERN-001` `Confirmed: 2026-11-23` in `docs/agents/PATTERNS.md`.
2. **Batched Backend Search Card Enrichment (`backend/src/services/rideService.js`, `backend/src/openapi.js`):**
   - Enriched `searchRides()` (`GET /api/rides`) with batched SQL queries (zero N+1 queries) to return `driver.rating_average`, `driver.rating_count`, `driver.seriousness_score`, `declared_trip_cost`, `stops`, and `price_lei` (preserving `segment_price_lei` and zero PII exposure), and added a dedicated integration test in `backend/tests/rides.test.js`.
3. **React 19 + Vite SPA Foundation (`frontend/`, `D-001`, `D-002`, `D-004`, `D-013`, `D-014`):**
   - Configured `frontend/package.json`, `frontend/vite.config.js` (proxying `/api` to `process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001'`), `frontend/index.html` (`<html lang="ro">`, JSON-LD `WebSite` schema, `Fraunces` + `DM Sans` fonts), and `frontend/src/tokens.css` (zero raw hex in React components, zero `dangerouslySetInnerHTML`).
   - Built `frontend/src/api/client.js` (`apiRequest`, `ApiError`, JWT Bearer header injection from `localStorage`), `frontend/src/context/ThemeContext.jsx` (light/dark toggle persisted in `localStorage` with `prefers-color-scheme` fallback), `frontend/src/context/AuthContext.jsx` (hydrated via `GET /api/auth/me`, handling `401` and `403 ACCOUNT_SUSPENDED`), and `frontend/src/hooks/useDocumentMeta.js` (per-route `<title>` and `<meta name="description">`).
4. **Core Screens (`DS-002`, `DS-003`, `DS-004`, `DS-005`, `DS-006`, `DS-010`):**
   - `LandingSearchPage.jsx` (`/` — `DS-002`) & `SearchResultsPage.jsx` (`/rides` — `DS-004`): debounced geocoding autocomplete (`GeocodeAutocomplete.jsx`, `GET /api/geocoding/search`), radius selector (`1/3/5 km`, `D-017`), `womenOnly` & `universityOnly` filters, travel-ticket ride cards with dual reputation (`D-016`), 30-day `"Anulare recentă"` badge, expandable stops (`D-005`), dynamic `price_lei` (`D-010`), topographic `RouteMap.jsx`, and transparent fuel-split breakdown box.
   - `AuthPage.jsx` (`/login` — `DS-003`): tabbed Register & Login card with live Romanian university domain detector (`Validat pe domeniu (nu identitate verificată)` per `D-004`), optional private gender selector (`D-018`), and inline validation.
   - `RideDetailsPage.jsx` (`/rides/:rideId` — `DS-005`) & `PublicProfilePage.jsx` (`/profile/:userId` — `DS-010`): ordered stop timeline with per-segment availability and dynamic `D-010` segment pricing, interactive pickup/drop-off segment selector, driver reputation card, confirmed passengers list, and public profile reviews (`GET /api/users/:userId/reviews`).
   - `PublishRidePage.jsx` (`/publish` — `DS-006`): single ride (`POST /api/rides`) and recurring rule (`POST /api/recurring-rides`, `D-006`, `D-020`) modes, dynamic stop builder with forward autocomplete + map click reverse geocoding (`D-009`), vehicle fuel consumption calculator feeding `declared_trip_cost`, live `D-010` seat cost cap preview, and `women_only` toggle gated by `user.gender === 'female'` (`D-018`).
5. **Tests & CI (`frontend/tests/`, `.github/workflows/ci.yml`):**
   - Added 13 Vitest unit/component tests across 4 files (`apiAndAuth.test.jsx`, `AuthPage.test.jsx`, `RideSearchAndDetails.test.jsx`, `PublishRidePage.test.jsx`) and added frontend test + production build steps to GitHub Actions CI (`D-015`).
