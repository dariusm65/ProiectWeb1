# Open questions — P18 Student Carpooling

<!-- graffino-agentic:begin v1 -->
> Unknowns. Work that depends on an open question is out of scope until it is
> answered. Only the user answers; an agent never answers by guessing. An agent may
> write a `Proposed answer` the evidence supports; the question stays
> `investigating` until the user confirms it.
> Answered entries stay, with the answer and date, and usually become a D- or PATTERN-.
<!-- graffino-agentic:end -->

## Index
- Q-001 · Which specific web lab assignment is currently being implemented? · _answered_
- Q-002 · What university email domains are allowed at registration? · _answered_
- Q-003 · Should the driver receive a notification when a passenger's reconfirmation deadline lapses (auto-cancel)? · _answered_
- Q-004 · What live hosting platform will be used for the public demo supporting Node.js and MySQL?
- Q-005 · What additional university email domains should be supported for Timișoara and Bucharest student clusters? · _answered_
- Q-006 · How is the passenger cancellation fee collected, settled, and reconciled against the declared trip cost? · _answered_

---

## Q-001 · Which specific web lab assignment is currently being implemented?
- **Status:** answered
- **Blocks:** Implementation of first lab files
- **Who answers:** Student / User
- **Proposed answer:** Lab 1 / Web introductory lab
- **Answer:** P18 — Student carpooling with segment matching (confirmed 2026-11-19)
- **Recorded as:** shapes the full project; see README.md and CONTEXT.md

---

## Q-002 · What university email domains are allowed at registration?
- **Status:** answered
- **Blocks:** Auth registration domain allowlist configuration; university domain badge display
- **Who answers:** User
- **Proposed answer:** `@ulbsibiu.ro`, `@stud.ubbcluj.ro`, `@student.utcluj.ro`, `@student.upt.ro`, `@e-uvt.ro`, `@stud.acs.upb.ro`, `@unibuc.ro` (unverified guesses based on survey clusters; to confirm with real colleague addresses post-deployment).
- **Answer:** Support all accredited Romanian universities by matching exact root domains OR any subdomain of them (e.g. `upb.ro` matches `stud.acs.upb.ro`, `ubbcluj.ro` matches `stud.ubbcluj.ro`, `ulbsibiu.ro`, `utcluj.ro`, `upt.ro`, `uvt.ro`, `e-uvt.ro`, `unibuc.ro`, `ase.ro`, `uaic.ro`, `tuiasi.ro`, `unitbv.ro`, `ucv.ro`, `uoradea.ro`, `umfcd.ro`, `umfcluj.ro`, `umft.ro`, `umfst.ro`, `utcb.ro`, `usamvcluj.ro`, `usv.ro`, `ugal.ro`, `univ-ovidius.ro`, `uab.ro`, `ub.ro`, etc.), plus an optional comma-separated `EXTRA_UNIVERSITY_DOMAINS` env var (confirmed 2026-11-22).
- **Recorded as:** D-004 (`backend/src/domain/universityDomains.js`)

---

## Q-003 · Should the driver receive a notification when a passenger's reconfirmation deadline lapses (auto-cancel)?
- **Status:** answered
- **Blocks:** Reconfirmation deadline lapse logic; notification design
- **Who answers:** User
- **Proposed answer:** Yes — the seat is freed and the driver should be informed so they know the seat is available again.
- **Answer:** Yes — when a passenger in pending_reconfirmation misses the deadline and auto-lapses, the seat is freed and the driver receives an in-app notification (evaluated lazily on read, created idempotently once per lapse).
- **Recorded as:** D-007

---

## Q-004 · What live hosting platform will be used for the public demo supporting Node.js and MySQL?
- **Status:** open
- **Blocks:** Live deployment configuration and CI/CD
- **Who answers:** User
- **Proposed answer:** Railway is candidate only, pending verification of current pricing and managed MySQL availability, with Render or a small VPS as Plan B.
- **Answer:**
- **Recorded as:**

---

## Q-005 · What additional university email domains should be supported for Timișoara and Bucharest student clusters?
- **Status:** answered
- **Blocks:** Auth registration domain allowlist configuration
- **Who answers:** User
- **Proposed answer:** `@student.upt.ro`, `@e-uvt.ro`, `@stud.acs.upb.ro`, `@unibuc.ro` (unverified guesses based on SURVEY.md clusters; to confirm with real student email addresses post-deployment).
- **Answer:** Covered by the accredited Romanian university root-domain + subdomain matcher (`upb.ro`, `unibuc.ro`, `ase.ro`, `umfcd.ro`, `utcb.ro`, `upt.ro`, `uvt.ro`, `e-uvt.ro`, `umft.ro`, etc.) plus optional `EXTRA_UNIVERSITY_DOMAINS` env var (confirmed 2026-11-22).
- **Recorded as:** D-004 (`backend/src/domain/universityDomains.js`)

---

## Q-006 · How is the passenger cancellation fee collected, settled, and reconciled against the declared trip cost?
- **Status:** answered
- **Blocks:** Cancellation fee UI and settlement documentation
- **Who answers:** User
- **Proposed answer:**
- **Answer:** The passenger cancellation fee (50% of the booked segment price, capped at 20 lei) is recorded by the app as an amount owed by the passenger to the driver and displayed to both parties on the cancelled booking. Because the platform has no in-app payment processing, the fee is settled directly between students outside the app (the app does not collect or process money). Known limitation: if the freed seat is subsequently booked by another passenger, the driver may end up collecting slightly more than the declared trip cost (by at most +20 lei).
- **Recorded as:** D-016
