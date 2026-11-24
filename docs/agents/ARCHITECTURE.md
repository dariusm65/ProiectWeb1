# Architecture — ULBS-Laborator

<!-- graffino-agentic:begin v1 -->
> How this repo is built, generated from the code at backfill and kept current by
> whoever changes the structure. The code wins: when this page is wrong, fix it.
<!-- graffino-agentic:end -->

## Overview
**StudRide (P18 — Student Carpooling with Segment Matching)** is a full-stack web application for ULBS Web Technologies coursework (`D-001`, `D-002`, `D-003`).
Currently implemented: containerized MySQL 8 database (`docker-compose.yml`), `mysql2` connection pool (`backend/src/db.js`), versioned raw SQL migration runner (`backend/database/migrate.js`), 15-table InnoDB schema (`001_initial_schema.sql`), idempotent seed scripts (`seed.js`, 36 real survey places with Nominatim coordinates + runtime-hashed system accounts), pure domain modules (`segmentAvailability.js`, `segmentPricing.js`, `universityDomains.js`, `geo.js`, `recurrence.js`, `seriousnessScore.js`), transactional services (`bookingAcceptanceService.js`, `bookingService.js`, `geocodingService.js`, `rideService.js`, `recurringRideService.js`, `chatService.js`, `notificationService.js`, `reviewService.js`, `moderationService.js`), Express 5 REST API with JWT + live-DB RBAC (`auth.js`, `geocoding.js`, `rides.js`, `recurringRides.js`, `bookings.js`, `notifications.js`, `users.js`, `reports.js`, `admin.js`, OpenAPI 3.0 at `/api/openapi.json` & `/api/docs`), React 19 + Vite SPA (`frontend/` implementing `DS-001`–`DS-008` and `DS-010` with light/dark theme tokens, JWT `AuthContext`, debounced geocoding autocomplete, spatial ride search, stop timeline & segment booking submission, passenger/driver dashboard, stop editing & reconfirmation, ride group chat, notifications inbox & navbar badge, post-arrival mutual star ratings, public profile reviews, and single/recurring ride publishing), GitHub Actions CI (`.github/workflows/ci.yml`), and Vitest unit/component + Supertest/MySQL integration suites (`backend/tests/`, `frontend/tests/`).

```text
[ React + Vite SPA (frontend/src/) ]
        │  HTTPS / JSON REST + JWT (D-002, D-004)
        ▼
[ Express REST API + OpenAPI (backend/src/) ] ──► [ Nominatim ]
        │  mysql2/promise raw SQL (D-003)         (cached in DB, D-009, C-001)
        ▼
[ MySQL 8 (InnoDB) via docker-compose.yml ]
```

## Parts
| Part | Path | Responsibility | Talks to |
|---|---|---|---|
| Database Infra | `docker-compose.yml`, `.env.example` | Local MySQL 8 container (`127.0.0.1:${DB_PORT:-3306}`), persistent volume, healthcheck | Host backend & tests |
| DB Pool | `backend/src/db.js` | `mysql2/promise` pool (`utf8mb4`, `timezone: 'Z'`, keep-alive, queue limit) | MySQL 8 |
| Migrations | `backend/database/migrate.js`, `migrations/001_initial_schema.sql` | Sequential raw SQL migrations tracked in `schema_migrations`; 15 InnoDB tables | MySQL 8 |
| Seeds & Geocoding Script | `backend/database/seed.js`, `seeds/*.sql`, `fetch-nominatim.js` | Transactional idempotent seed for 36 `SURVEY.md` localities + runtime `bcryptjs` system accounts | MySQL 8, Nominatim (script only) |
| Domain Logic | `backend/src/domain/` | Pure functions: segment availability (`D-005`), proportional pricing & reconfirm deadlines (`D-007`, `D-010`), university domains (`D-004`), Haversine/bounding box (`D-017`), recurrence & `Europe/Bucharest` time (`D-006`, `D-020`), seriousness score, cancellation fees & 30-day badge (`D-016`) | Services & routes |
| Backend Services | `backend/src/services/` | Transactional booking lifecycle, acceptance & lazy reconciliation (`D-003`, `D-005`, `D-007`, `D-010`, `D-016`, `D-018`, `D-019`), MySQL-cached Nominatim geocoding (`D-009`, `C-001`), ride publishing/details/spatial search/stop editing/cancellations, recurring ride rules/exceptions/on-demand materialisation (`D-006`), ride chat & notifications polling (`D-011`), post-arrival mutual star ratings (`D-008`), and moderation reports + transactional suspension cascade (`D-013`, `D-016`) | `domain/`, MySQL 8, Nominatim |
| Express API & OpenAPI | `backend/src/app.js`, `server.js`, `openapi.js`, `middleware/`, `routes/` | Express 5 REST routes (`/api/health`, `/api/auth`, `/api/geocoding`, `/api/rides`, `/api/recurring-rides`, `/api/bookings`, `/api/notifications`, `/api/users`, `/api/reports`, `/api/admin`), Zod validation (`D-014`), JWT + live-DB RBAC (`D-013`), Swagger UI (`/api/docs`) | Services, MySQL 8 |
| Backend Test Suite | `backend/tests/` | Vitest unit tests + Supertest/MySQL integration tests on isolated throwaway DBs (`studride_test*`) | `src/`, `database/`, MySQL 8 |
| Frontend SPA | `frontend/src/` | React 19 + Vite SPA implementing `DS-001`–`DS-008` and `DS-010` (`tokens.css`, `api/client.js`, `AuthContext`, `ThemeContext`, `LandingSearchPage`, `AuthPage`, `SearchResultsPage`, `RideDetailsPage`, `DashboardPage`, `RideChatPage`, `ReviewModal`, `PublicProfilePage`, `PublishRidePage`) | Backend REST API |
| Frontend Test Suite | `frontend/tests/` | Vitest + Testing Library unit and component suites (`apiAndAuth.test.jsx`, `AuthPage.test.jsx`, `RideSearchAndDetails.test.jsx`, `PublishRidePage.test.jsx`, `BookingsDashboardChatReviews.test.jsx`) | `frontend/src/` |
| Docs & Design System | `docs/agents/`, `docs/design/`, `docs/plans/` | Knowledge ledger (`D-001`–`D-020`, `C-001`, `PATTERN-001`–`PATTERN-003`), `DESIGN.md`, `registry.yaml`, `DS-001`–`DS-008` & `DS-010` HTML mocks | Developer & Agent |

## Data flow
1. Startup / test harness runs `migrate.js` to apply pending SQL migrations into MySQL 8 (`schema_migrations`), then `seed.js` to idempotently populate `known_places` and system accounts.
2. React SPA / API client communicates exclusively with Express REST endpoints using JWT (`Authorization: Bearer`); Express validates input with Zod (`D-014`), executes parameterized raw SQL via `backend/src/db.js` (with `SELECT FOR UPDATE` for booking acceptance and exception cancellation per `D-003`/`D-006`, and `INSERT IGNORE` on `uq_rule_instance` for on-demand recurring ride materialisation), and caches Nominatim lookups in `geocoding_cache` (`D-009`, `C-001`).

## State and storage
| What | Where | Owner | Notes |
|---|---|---|---|
| Persistent domain data (15 tables) | MySQL 8 (`mysql_data` Docker volume) | Backend (`backend/database/`) | InnoDB; `ON DELETE RESTRICT` on audit/booking/review/infraction FKs |
| Migration state | `schema_migrations` table | `backend/database/migrate.js` | Sequential version tracking |
| Geocoding cache | `geocoding_cache` table | Backend (`D-009`) | Persists across restarts; no Redis |
| Auth JWT *(planned)* | Browser `localStorage` | Frontend (`D-004`) | Sent as Bearer token |

## Configuration
| Name | Where set | Used by | Notes |
|---|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `MYSQL_ROOT_PASSWORD` | `.env` (git-ignored; template in `.env.example`) | `docker-compose.yml`, `backend/src/db.js` | Never commit `.env` |
| `ADMIN_PASSWORD`, `MODERATOR_PASSWORD` | `.env` | `backend/database/seed.js` | Hashed at runtime with `bcryptjs` |
| `JWT_SECRET` | `.env` | Planned Express auth middleware | Never commit |

## Build, deploy, runtime
- Database: `docker compose up -d` (MySQL 8 on `127.0.0.1:3306`)
- Migrations & seed: `cd backend && npm run migrate && npm run seed`
- Backend tests: `npm test --prefix backend` (Vitest)
- Frontend tests & build: `npm test --prefix frontend && npm run build --prefix frontend`
- Ledger lint: `python3 docs/agents/tools/ledger-lint.py`

## Boundaries
- Frontend ↔ Backend: REST JSON API only (`D-002`); no direct DB access from frontend.
- Backend ↔ MySQL: Parameterized raw SQL via `mysql2/promise` only (`D-003`); no ORM.
- External services: Nominatim/Photon geocoding only (cached in MySQL per `D-009`); no payment gateways, no external email/SMS/push services.
