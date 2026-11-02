# Product direction

## Audience

Start with developers building hiking, cycling and running route applications. The primary use case is preparing data for a route and obtaining its elevation profile offline.

## Product promise

Download only the region you need. Reuse it offline. Keep API keys and application servers out of the lookup path.

## MVP

TypeScript, Node.js first, explicit small-grid area planning, point and route samples, persistent cache, clear coverage and no-data errors. [Public alpha data](COVERAGE.md) covers a South Korea surrounding envelope and nine staged world cells with indexed range delivery. The prototype is a technical starting point, not evidence of real-world accuracy or demand.

## Non-goals

Worldwide high-resolution hosting, 3D rendering, accounts, payments, native mobile support and automatic multi-dataset merging. Cumulative ascent/descent is deferred until sampling and noise treatment are validated.

## Validation

The current [JSON-route example](../examples/published.ts) verifies public payload downloads and network-blocked reuse. GPX import and external developer trials remain future validation work. Provide a GPX demo showing selected tiles, estimated and actual bytes, an elevation profile and a repeat run with the network disabled. Ask 5–10 route-app developers to integrate it. Measure successful integration, repeat usage, download size and latency rather than stars alone.

## Acceptance gates for a regional alpha

- Redistribution rights, attribution, datum, resolution and void handling documented.
- Real reference points and adjacent-tile interpolation verified.
- Cold download and warm offline behavior benchmarked.
- Interrupted downloads, corrupt cache and unavailable regions handled explicitly.
- A real developer can use the quickstart without GIS preprocessing.

## Repository language

English is the default for documentation, code comments, issues, pull requests and commit messages.
