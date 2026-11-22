# P18 · Student Carpooling with Segment Matching

Laboratory project for Web Technologies — ULBS (Universitatea „Lucian Blaga" din Sibiu).

> **Survey data:** 18 responses, 13–18 Nov 2026. Full results and design decisions in [`SURVEY.md`](SURVEY.md).

---

## Scope

A web platform that lets students share rides between campus and home cities. Drivers publish rides with ordered intermediate stops; passengers search by origin -> destination -> date and book a seat on the exact segment they need. Seat availability is calculated per segment, not per ride, so a seat freed mid-route becomes bookable on the remaining segments.

### What is in scope
- Driver: publish single or recurring rides (rule + exceptions, instances materialised on demand); ordered stops with geocoded coordinates; preferences (luggage, pets, smoking, women-only).
- Passenger: search within a configurable radius; book a segment; reconfirm if a stop changes.
- Booking lifecycle: `pending -> confirmed / rejected / cancelled / pending_reconfirmation / expired`; cancellation policy from survey.
- Per-ride chat and in-app notifications (REST polling). Chat access restricted strictly to driver and `confirmed` / `pending_reconfirmation` passengers; immediately revoked upon cancellation, rejection, expiry, or lapse.
- Mutual ratings after ride completion; profile with star rating, ride count, seriousness score %, and domain-validated university badge.
- Reports on users, rides, and chat messages; moderator and admin panels.
- Transparent cost-splitting per segment; total paid by passengers <= driver's declared trip cost.
- Optional women-only rides based on self-declared private gender (`female` required to publish or book); categorized as lowest priority (2/18 survey respondents) and first candidate to cut if schedule requires.

### What is explicitly out of scope
- Online payments or money transfers — settlement is offline between students.
- Multi-seat bookings — every booking request is strictly for 1 seat per student account.
- External email / SMS / push notifications — in-app only.
- Turn-by-turn GPS navigation or live vehicle tracking.
- Social login (Google / Facebook) or document / photo uploads.
- Native mobile apps — responsive web only.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (JavaScript) |
| Backend | Express + REST API |
| API docs | OpenAPI / Swagger |
| Frontend | React (JavaScript) + Vite (SPA) |
| Map / Geocoding | Leaflet + Nominatim/Photon (forward & reverse geocoding) |
| Database | MySQL 8 |
| DB driver | `mysql2` — raw SQL, no ORM |
| Auth | JWT stored in `localStorage` |
| Real-time | REST polling (chat + notifications) |
| Testing | Vitest + Supertest |
| Dev environment | `npm run dev` (Vite + Express) with MySQL in Docker Compose |
| Grading / demo | `docker compose up` (MySQL + Express + React) |
| Production | Live URL (Render / Railway / VPS) |

---

## Variables (from survey)

### Routes and cities

| Route | Ordered intermediate stops |
|---|---|
| Reșița → Timișoara | Bocșa, Gătaia, Voiteg |
| Sibiu → Cluj-Napoca | Sebeș, Alba Iulia, Turda |
| Râmnicu Vâlcea → Sibiu | Călimănești, Câineni, Boița, Tălmaciu |
| Bacău → București | Adjud, Mărășești, Focșani, Buzău, Mizil, Ploiești |
| Sibiu → Timișoara | Deva |
| Hunedoara → Timișoara | Caransebeș |
| Vulcan → Timișoara | Caransebeș |
| Sântana (Arad) → Timișoara | Arad, Vinga, Orțișoara |
| Zalău → Cluj-Napoca | Zimbor |
| Mediaș → Sibiu | Copșa Mică, Șura Mare (+ ~4 localities) |

### Cancellation policy

| Actor | Trigger | Consequence |
|---|---|---|
| Driver | Cancels on the day of departure (confirmed passengers exist) | Immediate passenger notification; −5 percentage points seriousness score; "Recent Cancellation" badge (30 days); 7-day ride-publishing block |
| Passenger | Cancels < 4 h before departure | −3 percentage points seriousness score; pays 50 % of booked segment price (capped at 20 lei) |

### Search radius
Default **1 km**, expandable by the passenger up to **5 km**.

### Segment pricing and cost-sharing rule
The driver shares trip costs equally with passengers:
- `seat_full_price = declared_trip_cost / (available_seats + 1)`
- `cum(i) = (dist(origin -> i) / total_dist) * seat_full_price`
- `segment_price(A, B) = round_half_up(cum(B)) - round_half_up(cum(A))` (in whole lei, 0.5 rounded up).

Sub-segment prices always sum identically to the full-route seat price without clamping. The calculated price is permanently locked and stored on the booking record as `price_lei` at booking creation time; subsequent edits to `declared_trip_cost` or `available_seats` apply only to future bookings. The invariant that the sum of all passenger payments on a ride never exceeds `declared_trip_cost` remains strictly enforced.

### Reconfirmation deadline (stop modified after bookings exist)
- Modified **> 2 h before departure:** `deadline = min(now + 6 h, departure − 2 h)`
- Modified **<= 2 h before departure:** `deadline = min(now + 30 min, departure)`
- If deadline passes without passenger response -> booking auto-lapses; seat freed (evaluated lazily on read); driver is notified idempotently once per lapse.
- Driver cannot manually release a `pending_reconfirmation` seat before the deadline.

### Booking capacity & selective rejection
Pending requests do not hold capacity; only `confirmed` and `pending_reconfirmation` bookings hold seats. When a driver accepts a pending request in an InnoDB `SELECT FOR UPDATE` transaction, the backend auto-rejects ONLY those competing pending requests whose route traverses at least one elementary leg whose remaining capacity has just dropped to 0 (competing pending requests that overlap on legs where remaining capacity is still >= 1 remain `pending`). Passengers are notified when their pending request is auto-rejected or becomes `expired`. Unanswered pending requests automatically transition to `expired` at departure time (evaluated lazily on read).

### Registration & university domain badges
Anyone can register with any valid email so testers without a university address can still use the app. Only emails matching the approved university domain allowlist receive the "university domain" badge. The platform honestly discloses that domain matching is email-based, unverified, and only partially covers the 72% survey desire for verified identity (mailbox ownership and physical student identity are not confirmed). The filter label "Doar șoferi validați universitar" is retained for UI consistency.

---

## Running the project

```bash
# Full stack (MySQL + backend + frontend)
docker compose up

# Development (MySQL in Docker, backend and frontend on host)
npm run dev          # or: cd backend && npm run dev  |  cd frontend && npm run dev
```

---

## Definition of done

- [ ] Real routes from `SURVEY.md` are live and bookable.
- [ ] >= 5 colleagues have university accounts and a real ride has been booked on the live URL.
- [ ] Segment availability has >= 8 Vitest tests (overlapping segments, cancellations, modified stops, concurrent overbooking, partial-overlap non-rejection).
- [ ] Recurring ride with an exception works; bookings attach to materialised instances.
- [ ] Rating before ride completion is rejected (Vitest authorisation test).
- [ ] `SURVEY.md` §4 documents 3 requirements that changed the design.
- [ ] `docker compose up` starts the full stack cleanly.
