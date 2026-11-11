# Architecture — ULBS-Laborator

<!-- graffino-agentic:begin v1 -->
> How this repo is built, generated from the code at backfill and kept current by
> whoever changes the structure. The code wins: when this page is wrong, fix it.
<!-- graffino-agentic:end -->

## Overview
Web application and laboratory workspace for ULBS Web Technologies coursework.
Exercises run client-side in standard web browsers with optional local Node.js tooling.

```text
[ Browser / Client ] <---> [ Static Assets: HTML / CSS / JS ]
```

## Parts
| Part | Path | Responsibility | Talks to |
|---|---|---|---|
| Docs & Ledger | docs/agents/ | Project knowledge, decisions, and patterns | Agent & Developer |
| Design System | docs/design/ | Visual guardrails, tokens, component registry, and screenshots | Agent & Developer |
| Lab Exercises | ./ | Web coursework implementations | Browser |

## Data flow
1. User loads HTML/CSS/JS in browser -> Browser renders view and executes script logic.

## State and storage
| What | Where | Owner | Notes |
|---|---|---|---|
| Client state | LocalStorage / Memory | Browser | For client-side lab exercises |

## Configuration
| Name | Where set | Used by | Notes |
|---|---|---|---|
<!-- names only, never values -->

## Build, deploy, runtime
Runs directly in the browser or via local static server. See AGENTS.md section 2.

## Boundaries
Client-side browser sandbox.
