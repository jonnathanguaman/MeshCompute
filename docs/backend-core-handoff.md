# Backend Core (Persona 2A) — integration handoff

This document is the stable boundary for Integrantes A, C and Persona 2B.

## Ports and URLs

- Marketplace API from the local machine: `http://127.0.0.1:4000`
- Provider Agent on another machine: `http://<API-LAN-IP>:4000`
- The demo default binds the Marketplace API to `0.0.0.0`; change `HOST` when a
  network-accessible control plane is not required.
- Browser origin allowed by CORS: `WEB_URL` (`http://localhost:3000` by default)
- Every public route is prefixed with `/v1`; only `/health` is unprefixed.

## Contract decisions frozen by 2A

- The public provider price field remains `pricePer1kTokensAtomic` for compatibility
  with the original A/C specification.
- Pricing policy is `PER_JOB`; internally the public field maps to `priceAtomic` in
  `PricingService`.
- Clients cannot send `quotedAmountAtomic`. The API calculates and freezes it.
- Provider wallet and quote are snapshotted into the job at creation.
- Job creation performs `CREATED -> ASSIGNED` atomically and returns `ASSIGNED`.
  Therefore the first progress event from Consumer Agent is `CONNECTING`.
- A successful payment always leaves `job.status = PAID`. Its origin is represented
  by `paymentMode = SIMULATED | WDK_TESTNET`.
- `paymentStatus` is `PAID` for either successful mode; `SIMULATED` is not a job or
  payment status.

## Integrante A

### Provider registration

`POST /v1/providers/register`

```json
{
  "name": "Gaming-PC-01",
  "qvacPublicKey": "qvac-public-key-at-least-16-chars",
  "walletAddress": "0xProvider",
  "modelKey": "demo-llm",
  "modelLabel": "Llama-3.2-1B-Q4",
  "hardwareLabel": "RTX-4070",
  "pricePer1kTokensAtomic": "2000",
  "pricingMode": "PER_JOB"
}
```

The response contains a raw `providerToken` once. Heartbeats use:

```http
Authorization: Bearer <providerToken>
```

### Job progress

`PATCH /v1/jobs/:id/progress`

Use either:

```http
X-Execution-Token: <executionToken>
```

or a Bearer token. The intended sequence after job creation is:

```text
ASSIGNED -> CONNECTING -> RUNNING -> VERIFYING -> VERIFIED
```

`VERIFIED` requires a valid SHA-256 `outputHash`; verification becomes `PASSED`.
Raw output, prompt and tool results must never be sent to this API.

Reliability tools read:

- `GET /v1/providers/:id`
- `GET /v1/jobs/:id`

Both return metadata only and stable `404` codes.

## Integrante C

- `GET /v1/providers` returns all statuses so offline cards can be rendered.
- `GET /v1/providers?status=ONLINE` filters explicitly.
- `POST /v1/jobs` accepts only metadata and returns the provider snapshot,
  `jobId`, one-time `executionToken`, quote and `ASSIGNED` status.
- `GET /v1/jobs/:id` supports polling.
- The browser calculates `promptHash`; `prompt` is accepted by no central endpoint.

## Persona 2B

Implement `PricingService` and inject it through `buildMarketplaceApp`. Until then,
the core-safe PER_JOB default returns the provider snapshot price.

Implement settlement using only `JobSettlementPort`:

```ts
jobService.getForSettlement(jobId)
jobService.markPaymentPending(jobId)
jobService.markPaid(jobId, txHash, mode)
jobService.markPaymentFailed(jobId, code)
```

Add economic migrations under `apps/marketplace-api/migrations/economy/`. The core
migration runner discovers them automatically. Do not write directly to the jobs
table from settlement code.

## Stable error codes

- `VALIDATION_ERROR`
- `PROVIDER_NOT_FOUND`
- `PROVIDER_OFFLINE`
- `PROVIDER_MODEL_MISMATCH`
- `INVALID_PROVIDER_TOKEN`
- `JOB_NOT_FOUND`
- `INVALID_EXECUTION_TOKEN`
- `INVALID_JOB_TRANSITION`
- `OUTPUT_HASH_REQUIRED`
- `INVALID_VERIFICATION_STATUS`

Error responses never echo request bodies or secrets.

The complete machine-readable contract is available in [`docs/openapi.yaml`](openapi.yaml).

## Readiness and smoke test

`GET /health` verifies SQLite and returns `database: ready`; database failures return
HTTP `503`. With the API running against a disposable/demo database, A or C can run:

```bash
pnpm api:smoke
```

The command covers provider registration/heartbeat and the complete metadata-only
job progression through `VERIFIED`. It never prints raw tokens.

Pricing calls are bounded by `PRICING_TIMEOUT_MS` and fail with stable
`PRICING_TIMEOUT` or `PRICING_UNAVAILABLE` errors instead of hanging job creation.
