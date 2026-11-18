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
- Q-002 · What university email domains are allowed at registration? · _investigating_
- Q-003 · Should the driver receive a notification when a passenger's reconfirmation deadline lapses (auto-cancel)? · _investigating_

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
- **Status:** investigating
- **Blocks:** Auth registration endpoint; university badge display
- **Who answers:** User
- **Proposed answer:** `@ulbsibiu.ro`, `@stud.ubbcluj.ro`, `@student.utcluj.ro` — from interview (2026-11-19); the list lives in a backend config array so it can be extended without a code change.
- **Answer:**
- **Recorded as:**

---

## Q-003 · Should the driver receive a notification when a passenger's reconfirmation deadline lapses (auto-cancel)?
- **Status:** investigating
- **Blocks:** Reconfirmation deadline lapse logic; notification design
- **Who answers:** User
- **Proposed answer:** Yes — the seat is freed and the driver should be informed so they know the seat is available again.
- **Answer:**
- **Recorded as:**
