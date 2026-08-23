# MeshCompute — Arquitectura (estado real)

> Este documento describe lo que está implementado hoy, incluidas las
> extensiones posteriores al MVP de 24 h (portales, contratos, saldos,
> multi-máquina, pago automático). La especificación original vive en
> `00_MeshCompute_Global_Especificacion_24h.md`.

## Vista general

```text
                       ┌──────────────────────────┐
                       │    Marketplace API :4000  │
                       │  SOLO METADATOS (SQLite)  │
                       │  providers · jobs ·       │
                       │  users · contracts ·      │
                       │  payments · reputation    │
                       └─────────┬────────────────┘
                                 │ HTTP (hashes/estados/montos)
          ┌──────────────────────┼──────────────────────────┐
          │                      │                          │
          ▼                      ▼                          ▼
   Web :3001 (Next.js)    Consumer Agent :5050        Provider Agent
   marketplace + portales  (loopback, recibe prompt)  (QVAC provider)
          │                      │                          ▲
          │ prompt               │  QVAC P2P (delegated)    │
          └─────────────────────►╞══════════════════════════╡
                                 │  inferencia remota real  │
                                 └──────────────────────────┘
```

Regla central de privacidad (RNF-01): el prompt y el output **nunca** pasan por
el puerto 4000. El navegador entrega el prompt al Consumer Agent local
(127.0.0.1:5050) y este lo delega por QVAC P2P. Al control plane solo viajan
`promptHash`, `outputHash`, tokens, latencia, estados y montos.

## Módulos

| Módulo | Dónde vive | Notas |
|---|---|---|
| Contratos (M0) | `packages/contracts` | DTOs congelados + extensiones de portal en `portal.ts` |
| Provider Agent (M1) | `apps/provider-agent` | QVAC provider + registro + heartbeat 10 s |
| Consumer Agent (M2) | `apps/consumer-agent` | loopback estricto, CORS exacto, hashing, progreso |
| Reliability (M2R) | `apps/consumer-agent/src/reliability` | tools + Zod + scope + grounding + refusal; se activa solo con modelos `supportsTools` |
| Registry (M3) | `apps/marketplace-api` | upsert por public key; sweep OFFLINE (30 s) que ignora ofertas de portal |
| Jobs (M4) | `apps/marketplace-api` | state machine central, execution tokens, compare-and-set |
| Verification (M5) | consumer + API | `LOCAL_SCHEMA` y `REDUNDANT_DETERMINISTIC` (selector de verifier en la web) |
| Reputation (M6) | `services/reputation-service.ts` | +1 PAID / −5 FAILED / −10 VERIFICATION_FAILED, clamp 0–100, idempotente por `reputation_applied_at` |
| Payments (M7) | `packages/payment-adapter` | `SIMULATED` default; `WDK_TESTNET` con allowlist/caps (ver `testnet-payments.md`) |
| Frontend (M8) | `apps/web` | marketplace, job detail con trace, dashboard con benchmark honesto |

## Extensiones post-MVP (no estaban en la spec de 24 h)

- **Cuentas y portales** (`/login`, `/portal/provider`, `/portal/client`):
  email+contraseña (scrypt), sesiones Bearer de 7 días. El doc C §43 excluía
  login por alcance de hackathon; esta extensión no toca la ruta del prompt.
- **Ofertas vía portal**: un proveedor publica una o **muchas máquinas**
  (public key QVAC, descripción, precio, wallet) sin heartbeat; el sweep de
  OFFLINE no las apaga (`source='PORTAL'`).
- **Contratos**: el cliente contrata una máquina (REQUESTED → ACCEPTED/REJECTED/
  CANCELLED) con snapshot de precio.
- **Saldos**: cliente con crédito demo de 100 mUSDT (gasto = jobs PAID ligados a
  su sesión); proveedor ve lo cobrado por todas sus máquinas
  (`GET /v1/portal/wallet`).
- **Pago automático** (`AUTO_SETTLE=true` default): al reportar `VERIFIED`, la
  API liquida sola; el settle manual queda como reintento idempotente.
- **BUSY real**: el provider pasa a BUSY mientras su job está RUNNING y vuelve a
  ONLINE al terminar el cómputo; el heartbeat no pisa BUSY.
- **Settle por tokens** (`SETTLE_BY_TOKENS`, default false):
  `ceil(tokens/1000) × tarifa` en lugar del precio fijo PER_JOB.

## Flujo de un job (con pago automático)

```text
Web (hash local del prompt) → POST /v1/jobs (metadatos) → jobId + executionToken
Web → POST 127.0.0.1:5050/v1/inference (prompt)
Consumer → PATCH CONNECTING → QVAC loadModel(delegate) → PATCH RUNNING (provider BUSY)
Provider ejecuta → Consumer hashea + verifica → PATCH VERIFYING → PATCH VERIFIED
API: auto-settle → PAID → reputación +1 → saldos actualizados (provider ONLINE)
```

## Puertos y comandos

| Servicio | Puerto | Comando |
|---|---:|---|
| Web | 3001 | `pnpm web:dev` |
| Marketplace API | 4000 | `pnpm api:dev` |
| Consumer Agent | 5050 | `pnpm consumer:start` |
| Provider Agent | P2P | `pnpm provider:start` |
| Seed de demo | — | `pnpm demo:seed` / `pnpm demo:reset` |
| Benchmark Track 2 | — | `pnpm benchmark -- --adapter real --key <publicKey> --model tooluse-llm` |

## Divergencias documentadas respecto a la spec

- `GET /v1/providers` sin `?status` devuelve **todos** los providers ordenados
  (la web tiene filtros); la spec pedía default ONLINE. Documentado en
  `openapi.yaml`.
- `PaymentStatus` no incluye `SIMULATED`: se modela como `paymentStatus=PAID` +
  `paymentMode=SIMULATED`, y la UI etiqueta "SIMULATED" con ese modo.
- Los estados del portal (usuarios/contratos/saldos) son tablas nuevas; ninguna
  columna de contenido se añadió a `jobs`/`providers`.
