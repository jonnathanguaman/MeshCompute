# MeshCompute — Integrante B
## Marketplace API, SQLite, Jobs, Reputation, Payments/WDK y soporte de tools Track 2

> Tu responsabilidad es el **control plane**.
>
> No procesas IA. No recibes prompts. Coordinas providers, metadatos de jobs, reputación y settlement.

---

# 1. Ownership

Tú controlas:

```text
apps/marketplace-api/**
packages/payment-adapter/**
apps/marketplace-api/migrations/**
```

Además actúas como **merge captain** en checkpoints.

Compartido al inicio:

```text
packages/contracts/**
packages/config/**
```

Después de H1: congelar contratos.

---

# 2. Objetivo final

Debes entregar:

```text
Provider Registry
+
Heartbeat/offline detection
+
Job state machine
+
Metadata persistence
+
Verification metadata
+
Reputation
+
Payment adapter
+
WDK testnet or simulated
+
Stats
```

---

# 3. Tu arquitectura

```text
          Provider Agent
               │
               ▼
        Provider Registry
               │
               ▼
             SQLite
               ▲
               │
Web ───────► Marketplace API ◄──── Consumer Agent
               │
               ├── Jobs
               ├── Reputation
               └── Payments
                        │
                        ▼
                       WDK
```

Nunca:

```text
prompt → API
output → API
```

---

# 3A. Tu papel en Track 2 sin cambiar el backend

No implementas el agente ni tool calling. A necesita que tus datos existentes puedan actuar como **fuentes reales** para tools.

Debes garantizar que funcionen bien:

```text
GET /v1/providers/:id
GET /v1/jobs/:id
```

Esos endpoints alimentarán:

```text
get_provider_status
get_job_metadata
```

No añadas prompt/output/tool-result a SQLite. La tool obtiene metadata normal del control plane y el Consumer Agent mantiene el trace completo fuera de la base central.

Los errores deben ser distinguibles:

```text
404 NOT_FOUND
401/403 invalid execution context si aplica
5xx SERVER_ERROR
```

Esto permite que A pruebe refusal y retries con fallos reales o inyectados.

---

# 4. Lo primero que haces

## B0 — Monorepo y contratos

Mientras A prueba QVAC y C crea UI:

1. crear workspace;
2. crear `packages/contracts`;
3. crear API skeleton;
4. crear SQLite;
5. push temprano.

No esperes por QVAC.

---

# 5. API framework

Usar:

```text
Fastify
```

o:

```text
Express
```

Escoger uno y no cambiar.

Recomendación para velocidad:

```text
Fastify + Zod
```

pero Express también es válido si el equipo lo domina mejor.

---

# 6. Estructura

```text
apps/marketplace-api/
  src/
    index.ts
    app.ts
    config.ts

    routes/
      providers.ts
      jobs.ts
      stats.ts

    services/
      provider-service.ts
      job-service.ts
      reputation-service.ts
      payment-service.ts

    repositories/
      provider-repository.ts
      job-repository.ts
      payment-repository.ts

    db/
      connection.ts
      migrations.ts

    security/
      tokens.ts

    logger.ts
```

---

# 7. Base de datos

SQLite.

No usar ORM pesado si no está dominado.

Opciones:

```text
better-sqlite3
```

es suficiente.

---

# 8. Regla de privacidad en DB

La tabla jobs NO tiene:

```text
prompt
response
input_text
output_text
document
conversation
```

Haz una búsqueda antes de entregar:

```bash
grep -R "prompt TEXT\|response TEXT" apps/marketplace-api
```

No deben existir columnas de contenido.

---

# 9. Provider Registry

Endpoints:

```text
GET  /v1/providers
GET  /v1/providers/:id
POST /v1/providers/register
POST /v1/providers/:id/heartbeat
```

---

# 10. POST /providers/register

Validar:

- name;
- qvacPublicKey;
- walletAddress;
- modelKey;
- modelLabel;
- hardwareLabel;
- price atomic.

Usar upsert por:

```text
qvacPublicKey
```

Response:

```json
{
  "provider": {...},
  "providerToken": "..."
}
```

Token solo se devuelve al agent.

No aparece en GET.

---

# 11. providerToken

Generar:

```text
32 random bytes
```

Guardar:

```text
hash(token)
```

No guardar raw token.

Heartbeat:

```text
Authorization: Bearer ...
```

Seguridad ligera para demo.

---

# 12. Heartbeat

Cada request:

```text
lastSeen = now
status = ONLINE
```

Worker interno:

```text
cada 5–10 s
```

busca providers:

```text
now - lastSeen > 30s
```

y marca:

```text
OFFLINE
```

---

# 13. GET providers

Default:

```text
ONLINE
```

Query opcional:

```text
?status=ONLINE
```

Orden sugerido:

1. status;
2. reputation DESC;
3. price ASC.

---

# 14. Jobs

Endpoints:

```text
POST  /v1/jobs
GET   /v1/jobs
GET   /v1/jobs/:id
PATCH /v1/jobs/:id/progress
POST  /v1/jobs/:id/settle
```

---

# 15. POST /jobs — privacidad

Schema estricto.

Permitido:

```json
{
  "providerId": "p1",
  "modelKey": "demo-llm",
  "promptHash": "...",
  "consumerWallet": "0x..."
}
```

Prohibido:

```json
{
  "prompt": "secret"
}
```

Debe devolver:

```text
400
```

---

# 16. Job creation flow

```text
validate body
  │
  ▼
provider exists?
  │
  ▼
provider ONLINE?
  │
  ▼
model matches?
  │
  ▼
calculate quote
  │
  ▼
create executionToken
  │
  ▼
store token hash
  │
  ▼
insert job CREATED
```

Response incluye raw executionToken una sola vez.

---

# 17. Job state machine

Implementar función central:

```ts
canTransition(from, to)
```

Mapa:

```text
CREATED -> ASSIGNED
ASSIGNED -> CONNECTING
CONNECTING -> RUNNING | FAILED
RUNNING -> VERIFYING | FAILED
VERIFYING -> VERIFIED | VERIFICATION_FAILED
VERIFIED -> PAYMENT_PENDING
PAYMENT_PENDING -> PAID | PAYMENT_FAILED
```

Permitir `CANCELLED` solo donde tenga sentido.

---

# 18. PATCH progress

Autorización:

```text
X-Execution-Token
```

o Bearer.

Acepta exclusivamente campos de metadata.

Zod strict.

No aceptar:

```text
content
prompt
response
rawOutput
```

---

# 19. Quote de job

Para MVP:

```text
price per 1k tokens
```

Al crear job todavía no sabes output real.

Opciones:

### Simple

Precio fijo demo:

```text
quotedAmountAtomic = provider base price
```

### Mejor

Después de inferencia:

```text
totalTokens = input + output
amount = ceil(totalTokens / 1000) * rate
```

Para no bloquear integración, empieza con precio fijo.

---

# 20. Job completion metadata

Consumer Agent envía:

```json
{
  "status": "VERIFYING",
  "outputHash": "...",
  "inputTokens": 20,
  "outputTokens": 12,
  "durationMs": 1840
}
```

Nunca output.

---

# 21. Verification metadata

A no te envía contenido.

Recibes:

```json
{
  "status": "VERIFIED",
  "verificationStatus": "PASSED",
  "outputHash": "...",
  "verifierOutputHash": "..."
}
```

Si falla:

```text
VERIFICATION_FAILED
```

---

# 22. Reputation Service

Base:

```text
95
```

Cambios:

```text
PAID/verified +1
FAILED -5
VERIFICATION_FAILED -10
```

Clamp:

```text
0..100
```

---

# 23. Idempotencia reputation

Problema:

```text
settle called twice
→ reputation +2
```

Solución:

```text
reputation_applied_at
```

Si no es null:

```text
skip
```

---

# 24. Stats endpoint

```text
GET /v1/stats
```

Response:

```json
{
  "providersOnline": 2,
  "jobsTotal": 34,
  "jobsVerified": 31,
  "successRate": 91.2,
  "totalPaidAtomic": "42000"
}
```

C usa esto para dashboard.

---

# 25. Payment Adapter

Paquete:

```text
packages/payment-adapter/
```

Interfaz:

```ts
interface PaymentAdapter {
  settle(input: {
    recipient: string;
    amountAtomic: string;
    jobId: string;
  }): Promise<{
    status: 'PAID' | 'SIMULATED';
    txHash: string;
    feeAtomic?: string;
  }>;
}
```

Implementaciones:

```text
SimulatedPaymentAdapter
WdkEvmPaymentAdapter
```

Así el backend no cambia cuando WDK no esté listo.

---

# 26. SIMULATED primero

Antes de tocar blockchain, hacer que esto funcione:

```text
VERIFIED
↓
PAYMENT_PENDING
↓
SIMULATED
```

Fake tx:

```text
sim_job_123_...
```

Esto permite integrar C a H9–H12.

---

# 27. WDK después

Configuración:

```env
PAYMENT_MODE=TESTNET
EVM_RPC_URL=
MOCK_TOKEN_ADDRESS=
TREASURY_SEED_PHRASE=
TOKEN_DECIMALS=6
```

WDK:

- crear wallet EVM;
- obtener account;
- `quoteTransfer()`;
- `transfer()`.

Usar token de prueba.

No usar fondos reales.

---

# 28. Seguridad de WDK

Nunca:

- seed en frontend;
- seed en Git;
- seed en logs;
- seed en DB;
- USDT mainnet real.

`.gitignore`:

```text
.env
.env.local
*.db
```

---

# 29. Settlement flow

```text
POST settle
   │
   ▼
job exists?
   │
   ▼
status == VERIFIED?
   │
   ▼
already settled?
   ├── yes → return existing result
   │
   ▼ no
PAYMENT_PENDING
   │
   ▼
PaymentAdapter.settle()
   │
   ├── success
   │      ▼
   │     PAID/SIMULATED
   │
   └── fail
          ▼
      PAYMENT_FAILED
```

---

# 30. Payment attempts

Guardar cada intento.

Ventaja:

- debugging;
- demo;
- evita misterio de pagos.

No hace falta un sistema ledger completo.

---

# 30A. Failure injection solo para benchmark/dev

Para que A pueda medir reliability de forma repetible, puedes exponer fixtures o helpers **solo en desarrollo/test**, nunca como feature pública del producto.

Preferencia:

```text
scripts/fixtures/*.json
```

o tests que simulen:

```text
NOT_FOUND
EMPTY_METADATA
DELAY/TIMEOUT
```

No es obligatorio añadir endpoints especiales si A puede mockear el `marketplace-client`.

Regla: producción/demo normal usa los endpoints reales; failure injection está activado únicamente por flag de test.

---

# 31. Mock data para no depender de A

Crear:

```text
pnpm demo:seed
```

Providers:

```text
Gaming-PC-01
Gaming-PC-02
```

Jobs:

```text
RUNNING
VERIFIED
PAID
```

C puede trabajar desde H1.

---

# 32. Mock de A

Para probar progress:

```bash
curl -X PATCH ...
```

Simular:

```text
CONNECTING
RUNNING
VERIFYING
VERIFIED
```

No necesitas QVAC para construir state machine.

---

# 33. Tu orden real

No es:

```text
providers complete
↓
jobs complete
↓
payments
```

Haz:

```text
B1 contracts + skeleton
   │
   ├────► B2 provider endpoints
   │
   ├────► B3 job state machine
   │
   └────► B4 simulated payment
              │
       ┌──────┴──────┐
       ▼             ▼
 B5 reputation    B6 WDK spike
       │             │
       └──────┬──────┘
              ▼
           integrate
```

---

# 34. Cronograma personal

## H0–H1

- workspace;
- contracts;
- API skeleton;
- SQLite.

Push rápido para que otros puedan importar contratos.

## H1–H3

- provider register;
- heartbeat;
- get providers;
- job create.

## H3–H5

- job state machine;
- execution tokens;
- strict privacy schemas.

## H5–H7

- integration Provider Agent.
- stats endpoint.

## H7–H9

- simulated payment;
- reputation;
- seed demo.

## H9–H12

- integrate Consumer Agent progress.
- payment UI contract.

## H12–H14

- WDK testnet spike.

## H14–H16

- integrate WDK if stable.
- if not, keep simulated.

## H16–H18

- idempotency;
- failures;
- E2E.

## H18+

Only bug fixes.

---

# 35. Checkpoint H3

Entregar al equipo:

```text
GET /providers
POST /providers/register
POST /jobs
```

aunque faltan features.

---

# 36. Checkpoint H6

Provider A real debe aparecer.

C debe poder consumir providers API.

---

# 37. Checkpoint H9

Recibir estados reales de Consumer Agent.

---

# 38. Checkpoint H12

Un job real debe terminar en:

```text
VERIFIED
```

y poder hacer:

```text
SIMULATED payment
```

WDK real puede venir después.

---

# 39. Tests que tú debes tener

## Provider

- register;
- upsert;
- heartbeat;
- offline.

## Privacy

- reject prompt;
- reject response;
- DB without content.

## Jobs

- valid transitions;
- invalid transitions;
- wrong token rejected.

## Tool-source reliability

- GET provider por ID devuelve 200 o 404 determinista.
- GET job por ID devuelve schema estricto.
- ninguna respuesta incluye prompt/output.
- errores son suficientemente claros para refusal/retry del Consumer Agent.

## Payment

- settle verified;
- reject running job;
- idempotent double call.

## Reputation

- success once;
- failure once.

---

# 40. Endpoint examples

## Register

```http
POST /v1/providers/register
Content-Type: application/json
```

## Heartbeat

```http
POST /v1/providers/p_001/heartbeat
Authorization: Bearer ...
```

## Create job

```http
POST /v1/jobs
```

## Progress

```http
PATCH /v1/jobs/job_001/progress
X-Execution-Token: ...
```

## Settle

```http
POST /v1/jobs/job_001/settle
```

---

# 41. Error codes

Usar códigos estables:

```text
PROVIDER_NOT_FOUND
PROVIDER_OFFLINE
INVALID_JOB_TRANSITION
INVALID_EXECUTION_TOKEN
JOB_NOT_VERIFIED
PAYMENT_ALREADY_SETTLED
PAYMENT_FAILED
VALIDATION_ERROR
```

C mostrará mensajes con ellos.

---

# 42. Logging

Sí:

```text
jobId
providerId
status
payment tx
duration
```

No:

```text
prompt
output
token
seed phrase
```

---

# 43. Merge captain

En checkpoints:

1. actualizar main;
2. correr install;
3. correr typecheck;
4. correr tests;
5. merge A/C solo si contratos siguen válidos.

No hagas refactor global en medio de integración.

---

# 44. Definition of Done B

- [ ] SQLite migrates.
- [ ] providers table.
- [ ] jobs table sin content.
- [ ] payment attempts.
- [ ] provider register.
- [ ] provider token.
- [ ] heartbeat.
- [ ] offline detection.
- [ ] list providers.
- [ ] job create.
- [ ] execution token.
- [ ] progress.
- [ ] state machine.
- [ ] strict schemas.
- [ ] stats.
- [ ] reputation.
- [ ] simulated payment.
- [ ] settlement idempotent.
- [ ] WDK testnet si estable.
- [ ] tx hash.
- [ ] no secrets in logs.

---

# 45. Fallbacks

## WDK falla

```text
PAYMENT_MODE=SIMULATED
```

No bloquee el proyecto.

## SQLite falla

Para una demo extrema:

```text
in-memory repositories
```

pero SQLite debería ser suficientemente simple.

## A no está listo

Seed fake providers.

## C no está listo

Probar por curl.

---

# 46. Lo que no debes construir

- procesamiento de prompts;
- LLM;
- QVAC wrapper;
- frontend;
- smart contract escrow;
- auth OAuth;
- refresh tokens;
- microservices;
- Kafka;
- Redis;
- PostgreSQL.

---

# 47. Handoff

A necesita:

- provider endpoints;
- progress endpoint;
- token headers;
- error codes.

C necesita:

- providers;
- jobs;
- stats;
- settle;
- exact DTOs.

Equipo necesita:

- `.env.example`;
- seed script;
- payment mode;
- demo DB;
- comando para resetear DB.


---

# 48. Límite de responsabilidad Track 2

No construyas:

- otro agent loop;
- prompts del modelo;
- tool schemas del LLM;
- grounding evaluator;
- benchmark runner;
- UI de reliability.

Tu aporte a Track 2 es mantener un **control plane real, estricto y predecible** que A pueda consultar como herramienta sin comprometer privacidad ni retrasar WDK/reputation.
