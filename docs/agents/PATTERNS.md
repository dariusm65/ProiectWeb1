# Patterns — ULBS-Laborator

<!-- graffino-agentic:begin v1 -->
> How we build things here. Copy only `approved` entries. `candidate` = seen once or
> not yet confirmed; agents add these freely. Promotion needs the user's OK.
<!-- graffino-agentic:end -->

## Index
- PATTERN-001 · Modular separation of concerns for lab assignments · approved
- PATTERN-002 · Isolated throwaway MySQL database per integration test file · approved
- PATTERN-003 · Injectable fetchFn and nowFn for deterministic service and API tests · approved
- PATTERN-004 · Accessible WAI-ARIA modal dialog with focus trap, Escape close, and focus restoration · candidate
- PATTERN-005 · Single-query JOIN or IN-batched list endpoints to prevent UI N+1 fan-out · candidate

---

## PATTERN-001 · Modular separation of concerns for lab assignments
- **Status:** approved
- **Confirmed:** 2026-11-23
- **Use when:** Creating or structuring a new laboratory exercise.
- **How:** Keep HTML (structure), CSS (styling), and JavaScript (behavior) separated into distinct files or folders per assignment.
- **Example:** `lab1/index.html`, `lab1/style.css`, `lab1/script.js`
- **Why:** Adheres to clean code practices and academic grading rubrics.
- **Source:** user · confidence high

---

## PATTERN-002 · Isolated throwaway MySQL database per integration test file
- **Status:** approved
- **Confirmed:** 2026-11-23
- **Use when:** Adding a Vitest + MySQL integration test suite under `backend/tests/`.
- **How:** Give each integration test file its own dedicated throwaway database name (`studride_test_<suite>`), create and migrate it in `beforeAll`, drop it and close the pool in `afterAll`, and skip cleanly when MySQL is unreachable locally while throwing loudly when `process.env.CI` is set.
- **Example:** `backend/tests/auth.test.js` (`studride_test_auth`), `backend/tests/bookingAcceptance.test.js` (`studride_test_bookings`), `backend/tests/rides.test.js` (`studride_test_rides`), `backend/tests/bookings.test.js` (`studride_test_bookings_api`), `backend/tests/communityModeration.test.js` (`studride_test_community_mod`)
- **Why:** Allows Vitest to run multiple MySQL integration test files in parallel without table truncation or schema drop collisions.
- **Source:** Slice 2–5 backend tests

---

## PATTERN-003 · Injectable fetchFn and nowFn for deterministic service and API tests
- **Status:** approved
- **Confirmed:** 2026-11-23
- **Use when:** Building backend services or Express routers that depend on wall-clock time or external HTTP APIs (such as Nominatim geocoding).
- **How:** Accept `fetchFn = globalThis.fetch` and `nowFn = () => new Date()` in `createApp` and service factories so integration tests can inject mocks and fixed timestamps without global monkey-patching or live network calls.
- **Example:** `backend/src/app.js`, `backend/src/services/geocodingService.js`, `backend/tests/rides.test.js`, `backend/tests/bookings.test.js`, `backend/tests/communityModeration.test.js`
- **Why:** Guarantees zero live internet traffic in automated tests (`D-009`) and makes time-sensitive logic (7-day publishing bans, late-cancel windows, lazy expirations, post-arrival ratings) deterministic.
- **Source:** Slice 4A–5 implementation

---

## PATTERN-004 · Accessible WAI-ARIA modal dialog with focus trap, Escape close, and focus restoration
- **Status:** candidate
- **Use when:** Creating a modal dialog component in the React SPA (such as post-ride rating or moderation reporting).
- **How:** Render `<div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="...">`, store `document.activeElement` before opening, move initial focus to the close button, trap `Tab` / `Shift+Tab` inside the modal card's focusable elements, close on `Escape` or backdrop click, restore focus to the trigger element on unmount/close, and abort any in-flight `AbortController` submission on unmount.
- **Example:** `frontend/src/components/ReviewModal.jsx`, `frontend/src/components/ReportModal.jsx`
- **Why:** Satisfies WCAG keyboard and screen-reader dialog requirements (`D-001`) without pulling in external UI kit dependencies.
- **Source:** Slice 7–8 implementation

---

## PATTERN-005 · Single-query JOIN or IN-batched list endpoints to prevent UI N+1 fan-out
- **Status:** candidate
- **Use when:** Designing backend list endpoints consumed by rich dashboard or moderation tables.
- **How:** Fetch all required display context in a single `LEFT JOIN` query (e.g. `listReports`) or a constant number of `WHERE id IN (?)` batch queries grouped via `Map` in memory (e.g. `listUsersForModeration`, `listMyDrivenRides`, `searchRides`) so the frontend renders the entire view from one REST call with zero per-row requests.
- **Example:** `backend/src/services/moderationService.js` (`listReports`, `listUsersForModeration`), `backend/src/services/rideService.js` (`searchRides`, `listMyDrivenRides`)
- **Why:** Prevents N+1 SQL queries on the backend and N+1 HTTP waterfall requests on the frontend while keeping sensitive fields excluded at the query projection boundary.
- **Source:** Slice 6–8 implementation
