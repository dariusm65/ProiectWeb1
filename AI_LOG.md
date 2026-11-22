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
