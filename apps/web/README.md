# Persona C web base

The Next.js application owns the consumer-facing demo without duplicating the
backend or Consumer Agent. Its routes are:

- `/`: project story and architecture boundary.
- `/providers`: live provider discovery and selection.
- `/jobs/new?provider=<id>`: local prompt hashing and inference launch.
- `/jobs/<id>`: job state, in-memory result, reliability trace and settlement.
- `/dashboard`: provider/job/payment metrics plus an honest benchmark panel.

## Integration boundary

The browser sends only `providerId`, `modelKey`, `promptHash` and optional safe
metadata to the central API on port `4000`. The raw prompt is sent only to Persona
A's Consumer Agent on loopback port `5050`. Raw output and the sanitized reliability
trace live in React memory; refreshing the page intentionally removes them.

Persona A is integrated through:

- `GET http://127.0.0.1:5050/health`
- `POST http://127.0.0.1:5050/v1/inference`

The canonical request and response types come from `@meshcompute/contracts`; the
isolated browser client is `src/lib/consumer-agent.ts`.

Persona 2B is integrated through the economic endpoints:

- `POST /v1/jobs/:id/settle`
- `GET /v1/stats`

Both endpoints are implemented. Settlement remains `SIMULATED` by default and
can be switched to the bounded WDK testnet adapter from the backend environment.

## Configuration

Copy the root `.env.example` to `.env` and adjust:

```text
NEXT_PUBLIC_MARKETPLACE_API_URL=http://127.0.0.1:4000
NEXT_PUBLIC_CONSUMER_AGENT_URL=http://127.0.0.1:5050
NEXT_PUBLIC_USE_MOCKS=false
NEXT_PUBLIC_DEMO_MODE=true
```

Mocks are opt-in and visibly labelled. A real benchmark is shown only when a valid,
non-mock `artifacts/benchmark-results.json` exists; otherwise the UI says `NOT RUN`.

## Commands

```bash
pnpm web:dev
pnpm --filter @meshcompute/web test
pnpm web:build
```
