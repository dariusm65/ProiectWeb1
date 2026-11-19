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
- **Brand Mark:** Rounded-square Transit Teal (`var(--color-primary)`) icon containing a white graduation cap, cyan (`var(--color-accent)`) dotted route path with 3 stops (origin, intermediate, destination).
- **Wordmark:** "Stud" in `var(--color-text)` + "Ride" in `var(--color-accent)`.
- **Implementation:** Inline SVG strictly utilizing CSS variables (zero external image dependencies per D-001).

## Tokens

### Color
| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#EBF0F5` | `#0B1120` | Page background (soft cool mist / deep slate) |
| `--color-header` | `#E3ECEF` | `#0F172A` | Top navigation bar / header background |
| `--color-surface` | `#F9FBFD` | `#1E293B` | Elevated card & container surface |
| `--color-surface-subtle` | `#E2E9F0` | `#131C31` | Nested surface, stop chips, table row alternate |
| `--color-border` | `#CBD5E1` | `#334155` | Structural borders and dividers |
| `--color-border-subtle` | `#E2E8F0` | `#1E293B` | Subtle separators between route stops |
| `--color-text` | `#0F172A` | `#F8FAFC` | Primary headings, body copy, key data |
| `--color-text-muted` | `#64748B` | `#94A3B8` | Secondary / muted text, labels |
| `--color-primary` | `#0D9488` | `#0D9488` | Transit Teal — primary buttons, main pins |
| `--color-primary-hover` | `#0F766E` | `#14B8A6` | Primary button hover / focus |
| `--color-accent` | `#0284C7` | `#38BDF8` | Cyan — route lines, active links, "Ride" mark |
| `--color-success` | `#059669` | `#10B981` | Emerald — confirmed booking, free seats, university badge |
| `--color-warning` | `#D97706` | `#F59E0B` | Amber — pending_reconfirmation deadlines, alerts |
| `--color-error` | `#DC2626` | `#EF4444` | Crimson — cancellation penalties, error messages |

### Typography
| Token | Family | Size / line height | Weight | Use |
|---|---|---|---|---|
| `--font-sans` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | — | — | Default UI copy |
| `--font-mono` | `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace` | — | — | Tabular numbers: prices (`lei`), times, seats, percentages |
| `--font-size-xs` | `var(--font-sans)` | `0.75rem` / `1.3` | `500` | Badges, verification tags |
| `--font-size-sm` | `var(--font-sans)` | `0.875rem` / `1.4` | `400` | Small notes, stop names, helper text |
| `--font-size-base` | `var(--font-sans)` | `1rem` / `1.5` | `400` | Standard body copy, form inputs |
| `--font-size-lg` | `var(--font-sans)` | `1.125rem` / `1.4` | `600` | Card titles, route summary ("Sibiu → Cluj") |
| `--font-size-xl` | `var(--font-sans)` | `1.375rem` / `1.3` | `700` | Section headers |
| `--font-size-2xl` | `var(--font-sans)` | `1.75rem` / `1.2` | `700` | Primary page heading, hero banner |

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
| `--radius-full` | `9999px` | User avatar badges, pill filters |
| `--shadow-sm` | `0 1px 2px rgba(15, 23, 42, 0.05)` | Subtle card elevation |
| `--shadow-md` | `0 4px 6px -1px rgba(15, 23, 42, 0.08)` | Hovered ride card, dropdowns |
| `--shadow-lg` | `0 10px 15px -3px rgba(15, 23, 42, 0.12)` | Floating booking summaries, modals |
| `--transition-fast` | `150ms ease-in-out` | Button and link interaction transitions |

### Breakpoints / window sizes
| Name | Min | Max |
|---|---|---|
| `mobile` | `320px` | `767px` |
| `tablet` | `768px` | `1023px` |
| `desktop` | `1024px` | — |

## Hard-coded values found (to migrate)
| path:line | Value | Should be |
|---|---|---|
