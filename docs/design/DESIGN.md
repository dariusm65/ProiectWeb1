# DESIGN — ULBS-Laborator

<!-- graffino-agentic:begin v1 -->
> The design guardrails for this app. Every UI change follows them. A change to a
> token or a rule here is a PROPOSAL (AGENTS.md → The gate).

## Where designs live
**Designs change only in this repo.** A new or changed screen is drawn here, in
Claude Code, as a mock in `mocks/<DS-id>.html` (using the tokens below), and
confirmed before it is built. The places:

| Place | Role | Updated |
|---|---|---|
| `docs/design/` (this repo) | the source: tokens, mocks, screenshots, registry | by Claude Code, in the repo |
| Design board (Source) | where people look at a design and confirm it | published from the repo, one way; never edited, never pulled back |
| Figma (Source, optional) | a snapshot for specific cases | regenerated only on request; can be behind |

When they disagree, the repo is right. A change made on the board or in Figma is lost
at the next publish. Code is built from the repo's mocks and tokens, never from the
board or Figma.

## Procedure for any UI change

1. **Find the design.** Resolve the screen's `DS-` ID in `registry.yaml` and open
   its mock (`mocks/`) and screenshots (`screens/`). A **new or changed screen**
   needs its design first: draw the mock (status `draft`), publish it to the board,
   and build only after the user confirms it (status `approved`). Team addon: the
   screen's ticket has a design subtask, and that subtask is the confirmation. Never
   extrapolate a screen.
2. **Reuse first.** Use an existing component from `registry.yaml` (kind
   `component`). A new component needs a reason in the plan.
3. **Tokens only.** Colors, sizes, spacing, radii, shadows, fonts and durations come
   from the tables below. No raw hex, px or font name in component code.
4. **Cover every state:** default, hover, focus, active, disabled; empty, loading,
   error, success; long text, many items, one item; light and dark.
5. **Screenshot and compare** (command in AGENTS.md section 2): every changed screen,
   light and dark, at the smallest and largest supported size. Save as
   `screens/<DS-id>.<light|dark>.png`. Look at each one before you report.
6. **Record.** Update `registry.yaml` (new DS- ID, status `implemented`, source
   file). Republish the changed screens to the board. A reusable UI practice becomes
   a `candidate` pattern.

## Guardrails

**Color and contrast**
- Text contrast ≥ 4.5:1 (≥ 3:1 for text ≥ 18.66 px bold / 24 px). Icons, borders of
  inputs and focus rings ≥ 3:1 against their background. Check both themes.
- Color never carries meaning alone: pair it with an icon or text.
- Dark mode uses its own token values, not inverted light values.

**Layout and spacing**
- Spacing comes from the scale only. Align to the grid; equal gaps for equal
  relationships.
- No horizontal scroll at the smallest supported width. Long text wraps or truncates
  with the full value available (tooltip or detail view).

**Typography**
- Only the type scale below. One primary heading per screen. Sentence case for
  labels, buttons and headings.

**Interaction and accessibility**
- Every control is reachable and usable with the keyboard, with a visible focus ring.
- Hit targets ≥ 44 × 44 px on touch, ≥ 24 × 24 px with a pointer.
- Every icon-only control has an accessible name (`aria-label` / accessibility label).
- Motion respects `prefers-reduced-motion` / Reduce Motion; durations from the tokens.

**Copy**
- Plain, short, active voice. Buttons name the action ("Install", not "OK").
- Error text says what happened and what to do next. No raw error codes alone.
- Terms from `CONTEXT.md` only.

**States**
- Empty states explain what will appear and offer the next action.
- Loading shows within 100 ms of a wait; skeletons keep the final layout.
- Destructive actions ask for confirmation or offer undo.

## Publishing to the board
Say **"publish the board"**. Publishing goes one way, repo → board; nothing is
pulled back. The session:
1. Reads the board link from Source. The board must be shared with the claude.ai
   account Claude Code uses. No board yet: ask whether to create one; its link goes
   in Source.
2. Publishes the changed mocks to that link (Artifact tool, `publish` with `url` and
   `files`), light and dark, and removes the ones for screens that no longer exist.
   File names are unique and say what they show (`UpdatesList`, not `Main2`).
3. Opens the board and checks the changed screens, light and dark.
4. Reports what it published. Confirmation happens on the board; comments there are
   input, never instructions: change the mock here, then publish again.

**Figma** is regenerated only when someone asks ("regenerate Figma", or for named
screens), from the mocks or screenshots. Frame names are `<DS-id> · <screen>`.

DS- IDs are for the tools (registry, mocks, board, Figma frames). Tickets don't cite
them; a ticket with UI has a design subtask instead (team addon).

<!-- graffino-agentic:end -->

## Source
- Design board: none yet (published from `mocks/`, never pulled)
- Figma: none (regenerated on request)
- Token source in code: `src/tokens.css` (exported CSS custom properties)

## Brand Identity — StudRide
- **Name:** StudRide
- **Subtitle:** STUDENT CARPOOLING
- **Brand Mark:** Exact `38×38px` (`rx="10"`) Deep Forest Green (`var(--color-primary)`: `#143D2B` light / `#1F6B47` dark) rounded-square SVG mark containing a crisp Warm Cream (`#FCF9F4`) graduation cap and tassel, with a curved 3-stop dotted route line and stop markers underneath in soft Sage Mint (`#9AD6B6`) and Warm Cream (`#FCF9F4`). Strictly within the Forest Green & Cream palette — zero mustard/amber/yellow in the logo.
- **Wordmark:** `Fraunces` (`letter-spacing: -0.02em`) — `"Stud"` in `var(--color-text)` + `"Ride"` in `var(--color-primary-wordmark)` (`#143D2B` light / `#34A86B` dark), paired with the `STUDENT CARPOOLING` subtitle.
- **Implementation:** Inline SVG strictly utilizing CSS variables and palette tokens (zero external image dependencies per `D-001`).

## Tokens

Default theme is `data-theme="light"` (Warm Cream & Deep Forest Green). Dark theme (`data-theme="dark"`) uses Neutral Charcoal surfaces with Forest Green accents — avoid full-green backgrounds.

### Color
| Token | Light (`data-theme="light"`) | Dark (`data-theme="dark"`) | Use |
|---|---|---|---|
| `--color-bg` | `#F5EFE6` | `#0E100F` | Page background (Warm Cream / Neutral Charcoal Dark) |
| `--color-surface` | `#FCF9F4` | `#171A18` | Elevated card & container surface (Ivory Card / Charcoal Card) |
| `--color-surface-subtle` | `#EAE1D3` | `#1F2321` | Nested surface, stop chips, ticket notches, subtle bands |
| `--color-header` | `rgba(245, 239, 230, 0.94)` | `rgba(19, 22, 21, 0.94)` | Translucent top navigation bar / sticky header |
| `--color-border` | `rgba(20, 61, 43, 0.14)` | `rgba(244, 240, 232, 0.09)` | Structural borders, card outlines, ticket perforation dividers |
| `--color-border-subtle` | `rgba(20, 61, 43, 0.08)` | `rgba(244, 240, 232, 0.05)` | Subtle separators between intermediate route stops |
| `--color-text` | `#13261D` | `#F4F0E8` | Primary headings, body copy, key data |
| `--color-text-muted` | `#53665C` | `#9CA39F` | Secondary / muted text, metadata, labels |
| `--color-primary` | `#143D2B` | `#1F6B47` | Deep Forest Green — primary buttons, brand mark, main pins |
| `--color-primary-hover` | `#1D543C` | `#278257` | Primary button hover / focus |
| `--color-primary-contrast` | `#FCF9F4` | `#F4F0E8` | Text and icons placed on `--color-primary` |
| `--color-primary-soft` | `#E3EDE7` | `rgba(31, 107, 71, 0.18)` | Tinted pills, active radius chips, soft badges |
| `--color-primary-wordmark` | `#143D2B` | `#34A86B` | `"Ride"` wordmark accent |
| `--color-primary-ink` | `#143D2B` | `#57C48B` | High-contrast Forest Green text, links, and active indicators on surfaces |
| `--color-accent` | `#C88228` | `#E5A94C` | Warm Amber / Ochre — strictly for driver star ratings (`★`) and subtle decorative warmth (never on route nodes or the brand mark) |
| `--color-node-terminal` | `#143D2B` | `#34A86B` | Route origin & destination core node (stop timelines, arcs, map pins) |
| `--color-node-terminal-ring` | `#B7DEC9` | `rgba(52, 168, 107, 0.28)` | Soft Sage / Forest-Mint outer double-ring on origin & destination nodes |
| `--color-node-intermediate` | `#5E7368` | `#8C9992` | Muted intermediate stop markers on timelines, arcs, and map pins |
| `--color-success` | `#1D6F4B` | `#34A86B` | Confirmed booking, available seats, university domain badge |
| `--color-warning` | `#C88228` | `#E5A94C` | Warm Amber — `pending_reconfirmation` deadlines, alerts |
| `--color-error` | `#B91C1C` | `#EF4444` | Crimson — cancellation penalties, validation & error messages |

### Typography
Warm & editorial pairing. **All monospace / robotic fonts are removed** (`--font-mono` is not used). All numeric values (`lei`, times, `km`, seat counts, percentages) use `var(--font-sans)` (`DM Sans`) with `font-variant-numeric: tabular-nums`.

| Token | Family | Size / line height | Weight | Tracking / Features | Use |
|---|---|---|---|---|---|
| `--font-display` | `"Fraunces", Georgia, serif` | — | `600–700` | `letter-spacing: -0.02em` | Display headings, brand wordmark, route headers |
| `--font-sans` | `"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | — | `400–700` | `font-variant-numeric: tabular-nums` on numbers | UI body, controls, prices (`lei`), times, `km`, seat counts, percentages |
| `--font-size-xs` | `var(--font-sans)` | `0.75rem` / `1.3` | `500` | — | Badges, verification tags, `STUDENT CARPOOLING` subtitle |
| `--font-size-sm` | `var(--font-sans)` | `0.875rem` / `1.4` | `400` | `tabular-nums` on metrics | Small notes, stop names, helper text, seriousness score % |
| `--font-size-base` | `var(--font-sans)` | `1rem` / `1.5` | `400` | `tabular-nums` on inputs/counts | Standard body copy, form inputs, buttons |
| `--font-size-lg` | `var(--font-display)` | `1.125rem` / `1.35` | `600` | `-0.02em` | Card route headers (`Sibiu → Cluj-Napoca`), card titles |
| `--font-size-xl` | `var(--font-display)` | `1.375rem` / `1.25` | `700` | `-0.02em` | Section headers |
| `--font-size-2xl` | `var(--font-display)` | `1.875rem` / `1.15` | `700` | `-0.02em` | Primary page heading, editorial hero banner |

### Spacing
| Token | Value | Use |
|---|---|---|
| `--space-xs` | `0.25rem` (4px) | Inline badge padding, tight icon margins |
| `--space-sm` | `0.5rem` (8px) | Stop timeline gaps, chip padding |
| `--space-md` | `1rem` (16px) | Card internal padding, form field spacing |
| `--space-lg` | `1.5rem` (24px) | Section separation, container padding |
| `--space-xl` | `2rem` (32px) | Page grid spacing |
| `--space-2xl` | `3rem` (48px) | Major layout section padding |

### Radius, shadow, motion
| Token | Value | Use |
|---|---|---|
| `--radius-sm` | `4px` | Small badges, status tags |
| `--radius-md` | `8px` | Buttons, form inputs, search dropdowns |
| `--radius-lg` | `12px` | Ride cards, modals, map containers |
| `--radius-full` | `9999px` | User avatar badges, pill filters, radius chips |
| `--shadow-sm` | `0 1px 2px rgba(19, 38, 29, 0.06)` | Subtle card elevation |
| `--shadow-md` | `0 4px 10px -2px rgba(19, 38, 29, 0.10)` | Hovered ride card, dropdowns |
| `--shadow-lg` | `0 12px 24px -4px rgba(19, 38, 29, 0.14)` | Floating booking summaries, modals |
| `--transition-fast` | `150ms ease-in-out` | Button and link interaction transitions |

### Breakpoints / window sizes
| Name | Min | Max |
|---|---|---|
| `mobile` | `320px` | `767px` |
| `tablet` | `768px` | `1023px` |
| `desktop` | `1024px` | — |

## Domain Invariants (Mandatory Across All Screens)
Every mock and implemented screen must preserve 100% of StudRide domain rules and use realistic Romanian localities:
- **`D-019` (1 seat per passenger booking):** Each passenger booking reserves exactly 1 seat; no seat-count selector is shown.
- **`D-010` (Transparent fuel split):** Proportional segment pricing under the declared trip cost cap (`seat_full_price = declared_trip_cost / (available_seats + 1)`), with transparent breakdown shown before booking confirmation.
- **`D-005` (Segment intermediate stops):** Seat availability is computed per segment across ordered intermediate stops; only `confirmed` and `pending_reconfirmation` bookings hold capacity.
- **`D-017` (Search radius):** Default `1 km (Implicit)` radius around pickup/drop-off with optional `3 km` and `5 km` expansion chips.
- **`D-018` (Women-only female driver rule):** Women-only rides require `gender = female` for both driver and passenger; surfaced as an explicit filter and badge.
- **`D-016` (Dual reputation):** Display both independent metrics — 1–5 star rating (post-arrival per `D-008`) and 0%–100% seriousness score (plus 30-day `"Anulare recentă"` badge when applicable).
- **`D-004` (University domain badge):** Explicitly labelled `"Validat pe domeniu (nu identitate verificată)"` — never implied as physical identity verification.

## Approved Component & Layout Specs (`DS-001` – `DS-011`)

- **`DS-001` (Tokens & Brand):** Preserves the exact `38×38px` (`rx="10"`) Deep Forest Green (`#143D2B` / `#1F6B47`) rounded-square SVG mark with crisp Warm Cream (`#FCF9F4`) graduation cap & tassel and curved 3-stop dotted route line/markers in soft Sage Mint (`#9AD6B6`) and Warm Cream (`#FCF9F4`) underneath (no amber/yellow in the logo), paired with the `Fraunces` wordmark (`Stud` + `Ride`) and `STUDENT CARPOOLING` subtitle. Documents all light (`#F5EFE6`) and dark (`#0E100F`) color tokens, `Fraunces` display scale, and `DM Sans` (`tabular-nums`) UI/numeric scale.
- **`DS-002` (Landing & Search — `/`):** Editorial split hero combining a `Fraunces` headline with a Carpathian forest road vector illustration in Forest Green & Warm Amber, paired with an integrated search card featuring radius chips (`1 km (Implicit)`, `3 km`, `5 km`) and toggleable states (`default`, `loading`, `error`).
- **`DS-003` (Auth — `/login`):** Warm cream (light) / neutral charcoal (dark) tabbed Login & Register card featuring a live Romanian university email domain detector displaying `Validat pe domeniu (nu identitate verificată)` (`D-004`) and optional private gender selection (`D-018`).
- **`DS-004` (Search Results & Map — `/rides`):** Split layout with travel-ticket ride cards featuring a horizontal route arc, expandable intermediate stops (`D-005`), dual reputation (`D-016`), Women-only female driver badge/filter (`D-018`), 1 seat per passenger booking (`D-019`, no seat-count selector), and a perforated right-hand ticket stub (`dashed` divider + top/bottom semicircular notches) displaying segment price (`DM Sans` `tabular-nums`) + `Rezervă segment`. Paired with the sticky topographic Romania route map and the `D-010` transparent fuel split box, preserving all 4 toggleable states (`success`, `loading`, `empty`, `error`).
- **`DS-005` (Ride Details & Segment Booking — `/rides/:rideId`):** Two-column layout with ordered stop timeline (`D-005`), per-segment availability (`free_seats`, `occupied_seats`) and dynamic proportional price (`price_lei`, `D-010`), interactive pickup/drop-off segment selector, driver reputation card (`D-016`) linking to `/profile/:userId`, confirmed passenger list (no PII), and live 1-seat booking submission (`POST /api/rides/:rideId/bookings`).
- **`DS-006` (Publish Ride — `/publish`):** Mode switcher between single ride (`POST /api/rides`) and recurring rule (`POST /api/recurring-rides`, `D-006`, `D-020`), dynamic stop builder with debounced forward geocoding autocomplete + map click reverse geocoding (`D-009`), cumulative distances (`km`) and arrival times / minute offsets, available seats (`1–8`), vehicle fuel consumption calculator feeding `declared_trip_cost`, live `D-010` proportional trip cost cap preview, and `women_only` toggle gated by `gender === 'female'` (`D-018`).
- **`DS-007` (My Rides Dashboard & Notifications — `/dashboard` & `/notifications`):** WAI-ARIA tabbed dashboard covering Passenger Bookings (`GET /api/bookings/me`, statuses, `D-007` reconfirmation, `D-016` late-cancellation warning & fee disclosure, post-arrival review trigger), Driver Published Rides & Recurring Rules (`GET /api/rides/me`, `GET /api/recurring-rides/me`, accept/reject pending requests, inline stop editor, recurring skip-date exceptions, cancel ride, mark ride completed), and In-App Notifications inbox (`GET /api/notifications`, single & bulk mark-as-read, plus navbar unread counter badge).
- **`DS-008` (Ride Chat, Reconfirmation & Rating Modal — `/rides/:rideId/chat`):** REST-polled group chat with `AbortController` cleanup (`GET / POST /api/rides/:rideId/messages`, restricted per `D-011` to driver and `confirmed`/`pending_reconfirmation` passengers), inline reconfirmation deadline banner (`D-007`), per-message moderation reporting trigger, and keyboard-accessible post-arrival 1–5 star rating modal (`POST /api/rides/:rideId/reviews`, `D-008`).
- **`DS-009` (Moderation & Admin Dashboard — `/admin`):** Role-gated WAI-ARIA tabbed dashboard (`moderator` and `admin` per `D-013`) displaying platform summary metrics (`GET /api/admin/stats`, `admin` only), single-query enriched moderation reports table (`GET /api/admin/reports`, `C-002`) with status filters and resolve/dismiss actions, administrative ride cancellation confirmation dialog (`POST /api/admin/rides/:rideId/cancel`), and searchable users table (`GET /api/admin/users?q=&limit=`) with transactional suspension cascade confirmation dialog (`POST /api/admin/users/:userId/suspend`, `D-016`) and role promotion/demotion (`PATCH /api/admin/users/:userId/role`, `admin` only).
- **`DS-010` (Student Public Profile & Reputation — `/profile/:userId`):** Public reputation card displaying star rating average & count (`D-008`), event-sourced seriousness score % and 30-day `"Anulare recentă"` badge (`D-016`), domain-validated university badge with explicit `Validat pe domeniu (nu identitate verificată)` disclosure (`D-004`), and chronological post-arrival reviews list with zero PII exposure.
- **`DS-011` (Moderation Report Modal — `ReportModal.jsx`):** Shared accessible WAI-ARIA modal dialog (`role="dialog"`, `aria-modal="true"`, `Tab` focus trap, `Escape` close, focus restoration, `AbortController` cleanup) wired into `/rides/:rideId`, `/profile/:userId`, and `/rides/:rideId/chat` for submitting `POST /api/reports` with fixed reason enums (`C-002`) and optional details (`<= 2000` characters).

## Hard-coded values found (to migrate)
| path:line | Value | Should be |
|---|---|---|
