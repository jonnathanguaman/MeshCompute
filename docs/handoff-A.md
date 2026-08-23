# Handoff — Integrante A

> Doc 01 §39. Lo que B, C y el equipo necesitan de mi parte.

---

## Para Integrante C — Consumer Agent local

El agente escucha **solo** en `127.0.0.1:5050`. C no necesita saber nada de QVAC.

### Arrancarlo

```bash
pnpm consumer:start
```

### `GET /health`

Sirve para detectar si el agente está abierto (doc 01 §16). Si esto falla, la UI
debe mostrar el mensaje de T-10:

```
Consumer Agent not running.
Start it with pnpm consumer:start
```

```json
{ "status": "ok", "service": "consumer-agent", "qvacReady": true }
```

`qvacReady` es `true` cuando hay al menos una sesión QVAC viva. En el primer
arranque es `false` hasta la primera inferencia: **no** es un error.

### `POST /v1/inference`

```bash
curl -X POST http://127.0.0.1:5050/v1/inference \
  -H 'Content-Type: application/json' \
  -d @docs/examples/inference-request.json
```

Request (`LocalInferenceRequest` en `@meshcompute/contracts`):

```json
{
  "jobId": "job_123",
  "executionToken": "...",
  "provider": {
    "id": "p_001",
    "qvacPublicKey": "<64 hex chars>",
    "modelKey": "tooluse-llm"
  },
  "verifier": { "id": "p_002", "qvacPublicKey": "<64 hex chars>" },
  "prompt": "...",
  "verificationMode": "LOCAL_SCHEMA"
}
```

- `verifier` es opcional; solo se usa con `verificationMode: "REDUNDANT_DETERMINISTIC"`.
- `qvacPublicKey` **debe** ser 64 caracteres hex. Cualquier otra cosa da `INVALID_REQUEST`.
- El schema es `.strict()`: un campo de más devuelve 400.

Respuesta (`LocalInferenceResponse`):

```json
{
  "jobId": "job_123",
  "content": "{\"providerStatus\":\"ONLINE\",\"expectedAmountAtomic\":\"2310\",...}",
  "outputHash": "c1f14cdd...",
  "stats": { "inputTokens": 128, "outputTokens": 320, "durationMs": 3 },
  "verification": { "mode": "LOCAL_SCHEMA", "status": "PASSED" },
  "reliability": {
    "status": "PASSED",
    "requiredTools": 3,
    "successfulTools": 3,
    "failedTools": 0,
    "retries": 0,
    "schemaPassed": true,
    "groundingPassed": true,
    "trace": [
      { "turn": 1, "toolName": "get_provider_status",   "argsValid": true, "executionStatus": "SUCCESS", "durationMs": 1, "retryCount": 0 },
      { "turn": 2, "toolName": "get_job_metadata",      "argsValid": true, "executionStatus": "SUCCESS", "durationMs": 0, "retryCount": 0 },
      { "turn": 3, "toolName": "calculate_expected_cost","argsValid": true, "executionStatus": "SUCCESS", "durationMs": 1, "retryCount": 0 }
    ]
  }
}
```

### Códigos de error

Todos llegan como `ApiErrorDTO` (`{ code, message, details? }`).

| code | HTTP | Qué mostrar |
|---|---:|---|
| `PROVIDER_UNREACHABLE` | 502 | El provider seleccionado no responde. Ofrecer elegir otro. |
| `INFERENCE_TIMEOUT` | 504 | El provider tardó demasiado. Reintentar. |
| `VERIFICATION_FAILED` | 422 | El resultado no pasó la verificación local. |
| `INVALID_REQUEST` | 400 | Bug del cliente; `details.issues` trae los campos. |
| `CONSUMER_AGENT_BUSY` | 409 | Ya hay una inferencia en curso. Esperar. |
| `QVAC_UNAVAILABLE` | 503 | El runtime local no arrancó. Sugerir `pnpm qvac:doctor`. |

### Para pintar el Tool Trace (RF-F11 / RF-F12)

- `reliability.status` → badge: `PASSED` / `REFUSED` / `FAILED`.
- `schemaPassed` y `groundingPassed` → dos badges separados. **`REFUSED` no es un
  bug**: es el sistema negándose a inventar, y conviene que la demo lo luzca.
- `refusalReason` solo aparece cuando `status !== 'PASSED'`.
- `trace[]` no contiene el prompt ni los resultados crudos de las tools
  (RNF-14). No hay nada sensible que ocultar al renderizarlo.

### CORS

El agente solo acepta el origen exacto de `WEB_ORIGIN` (por defecto
`http://localhost:3000`). Si la web se sirve en otro puerto, hay que cambiar esa
variable o el navegador bloqueará las peticiones.

---

## Para Integrante B — lo que consumo y lo que envío

### Endpoints que consumo

```
POST  /v1/providers/register        (provider-agent)
POST  /v1/providers/:id/heartbeat   (provider-agent, cada 10 s)
PATCH /v1/jobs/:id/progress         (consumer-agent)
GET   /v1/providers/:id             (tool get_provider_status)
GET   /v1/jobs/:id                  (tool get_job_metadata)
```

Los dos `GET` son los que alimentan las tools del Reliability Orchestrator. Si
devuelven 404, el orchestrator rehúsa correctamente en vez de inventar — eso ya
está probado, así que un 404 limpio es mejor que un 200 con campos vacíos.

### Registro (formato exacto)

`POST /v1/providers/register`

```json
{
  "name": "Gaming-PC-01",
  "qvacPublicKey": "d03c6283d7b28572703850970a7c1aa04709c77129362d05fb417a0fd2c880bf",
  "walletAddress": "0x...",
  "modelKey": "demo-llm",
  "modelLabel": "Llama-3.2-1B-Q4",
  "hardwareLabel": "RTX-4070",
  "pricePer1kTokensAtomic": "2000"
}
```

Espero de vuelta `{ id | providerId, providerToken | token }`. La `qvacPublicKey`
es siempre 64 hex y es estable si se fija `QVAC_HYPERSWARM_SEED`.

### Heartbeat

`POST /v1/providers/:id/heartbeat` con `Authorization: Bearer <providerToken>`,
cada 10 s. Si falla, **no** apago QVAC: aviso y reintento (PA-005).

### Progreso de job

`PATCH /v1/jobs/:id/progress`. Envío **solo** estos campos:

```json
{
  "status": "VERIFIED",
  "outputHash": "<64 hex>",
  "inputTokens": 1200,
  "outputTokens": 340,
  "durationMs": 1820,
  "verificationStatus": "PASSED"
}
```

Estados que emito, y ningún otro (doc 01 §25):

```
CONNECTING -> RUNNING -> VERIFYING -> VERIFIED | VERIFICATION_FAILED
                                    -> FAILED
```

`PAYMENT_PENDING`, `PAID` y `PAYMENT_FAILED` son tuyos: mi cliente **lanza una
excepción** si alguien intenta emitirlos desde aquí, y hay un test que lo cubre.

### Privacidad — lo que puedes asumir

`JobProgressPatchSchema` es `.strict()` y se valida **antes** de salir por la
red. Si algún día un `content` o `prompt` se colase en el patch, el envío falla
en mi lado en vez de llegarte. Tu API debería rechazarlo igualmente (T-03,
defensa en profundidad).

---

## Para el equipo

### Comandos

```bash
pnpm install
pnpm qvac:doctor        # diagnóstico del entorno — correr una vez por máquina
pnpm provider:start     # máquina provider
pnpm consumer:start     # máquina consumidora
pnpm test               # 50 tests, sin red ni GPU
pnpm benchmark          # ver README para el modo reportable
```

### Prueba en dos máquinas

Guía completa con criterios de éxito y troubleshooting:
[`docs/prueba-dos-maquinas.md`](prueba-dos-maquinas.md).

### Calentar la conexión antes de la demo

Esto no es opcional (doc 00 §39):

1. `pnpm qvac:doctor` en **ambas** máquinas. El primer arranque del worker Bare
   suele hacer timeout a los 30 s porque extrae los prebuilds nativos; el
   segundo intento tarda ~5 s. Que no pase en la demo.
2. `pnpm provider:start` con `PROVIDER_WARMUP_MODEL=true` y esperar a ver
   `model_warmup_done`. La primera vez descarga el GGUF (737 MB Llama /
   1 GB Qwen3).
3. Una inferencia de prueba completa desde la máquina consumidora. La primera
   conexión DHT cuesta 15–45 s; las siguientes son sub-segundo sobre el mismo
   socket.
4. **No reiniciar el provider después de calentar**: el SDK no reconecta solo
   si el provider se cae. Si hay que reiniciarlo, reiniciar también el consumer.

### Public key del provider

Se imprime en el banner de arranque. Es pública por diseño (el consumer la
necesita para conectar). Para que no cambie entre reinicios, fijar
`QVAC_HYPERSWARM_SEED` en el `.env` del provider.
