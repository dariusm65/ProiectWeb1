# Patterns — ULBS-Laborator

<!-- graffino-agentic:begin v1 -->
> How we build things here. Copy only `approved` entries. `candidate` = seen once or
> not yet confirmed; agents add these freely. Promotion needs the user's OK.
<!-- graffino-agentic:end -->

## Index
- PATTERN-001 · Modular separation of concerns for lab assignments · approved
- PATTERN-002 · Isolated throwaway MySQL database per integration test file · candidate
- PATTERN-003 · Injectable fetchFn and nowFn for deterministic service and API tests · candidate

---

## PATTERN-001 · Modular separation of concerns for lab assignments
- **Status:** approved
- **Use when:** Creating or structuring a new laboratory exercise.
- **How:** Keep HTML (structure), CSS (styling), and JavaScript (behavior) separated into distinct files or folders per assignment.
- **Example:** `lab1/index.html`, `lab1/style.css`, `lab1/script.js`
- **Why:** Adheres to clean code practices and academic grading rubrics.
- **Source:** user · confidence high

---

## PATTERN-002 · Isolated throwaway MySQL database per integration test file
- **Status:** candidate
- **Confirmed:** 2026-11-23
- **Use when:** Adding a Vitest + MySQL integration test suite under `backend/tests/`.
- **How:** Give each integration test file its own dedicated throwaway database name (`studride_test_<suite>`), create and migrate it in `beforeAll`, drop it and close the pool in `afterAll`, and skip cleanly when MySQL is unreachable locally while throwing loudly when `process.env.CI` is set.
- **Example:** `backend/tests/auth.test.js` (`studride_test_auth`), `backend/tests/bookingAcceptance.test.js` (`studride_test_bookings`), `backend/tests/rides.test.js` (`studride_test_rides`)
- **Why:** Allows Vitest to run multiple MySQL integration test files in parallel without table truncation or schema drop collisions.
- **Source:** Slice 2–4A backend tests

---

## PATTERN-003 · Injectable fetchFn and nowFn for deterministic service and API tests
- **Status:** candidate
- **Confirmed:** 2026-11-23
- **Use when:** Building backend services or Express routers that depend on wall-clock time or external HTTP APIs (such as Nominatim geocoding).
- **How:** Accept `fetchFn = globalThis.fetch` and `nowFn = () => new Date()` in `createApp` and service factories so integration tests can inject mocks and fixed timestamps without global monkey-patching or live network calls.
- **Example:** `backend/src/app.js`, `backend/src/services/geocodingService.js`, `backend/tests/rides.test.js`
- **Why:** Guarantees zero live internet traffic in automated tests (`D-009`) and makes time-sensitive logic (7-day publishing bans, late-cancel windows, lazy expirations) deterministic.
- **Source:** Slice 4A implementation
