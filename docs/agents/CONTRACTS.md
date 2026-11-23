# Contracts — ULBS-Laborator

<!-- graffino-agentic:begin v1 -->
> Promises across a boundary. **Provided:** this repo owns the contract; the text
> lives here only. **Consumed:** a link to the provider's entry plus the fields this
> repo relies on. **External:** what we rely on from a third-party service.
> Changing a provided contract is a PROPOSAL (AGENTS.md → The gate) and the plan
> lists the consumers' files too. Status: `approved` · `proposed` · `superseded-by`.
<!-- graffino-agentic:end -->

## Index
- C-001 · OpenStreetMap Nominatim usage policy and rate limiting · external

---

## Provided

## Consumed

## External

### C-001 · OpenStreetMap Nominatim usage policy and rate limiting
- **Status:** approved
- **Confirmed:** 2026-11-23
- **Interface:** Outbound HTTP requests to `https://nominatim.openstreetmap.org/search` and `/reverse` (`format=jsonv2`) must send a descriptive custom `User-Agent` header identifying the StudRide ULBS coursework project, enforce an in-process rate limit of at most 1 request per second (`>= 1.1 s` gap between outbound requests), and persist results in MySQL `geocoding_cache` (`D-009`). Cache hits, `known_places` hits, and injected test `fetchFn` mocks with `throttleMs: 0` must never be throttled.
- **Evidence:** OpenStreetMap Nominatim Usage Policy (max 1 req/sec, custom User-Agent, caching); Slice 4A planning gate, 2026-11-23.
- **Source:** user · confidence high
