# MeshCompute — Integrante A
## QVAC, Provider Agent, Consumer Agent, Reliability Orchestrator y benchmark Track 2

> Tu responsabilidad es que el cómputo remoto sea real.
>
> Si tu parte funciona, una máquina puede pedir una inferencia y otra máquina físicamente distinta la ejecuta mediante QVAC P2P.

---

# 1. Ownership

Solo tú modificas normalmente:

```text
apps/provider-agent/**
apps/consumer-agent/**
packages/qvac-adapter/**
apps/consumer-agent/src/reliability/**
scripts/reliability-benchmark.ts
```

No modificar sin coordinación:

```text
apps/marketplace-api/**
apps/web/**
packages/contracts/**
```

---

# 2. Objetivo final

Debes entregar:

```text
Provider Agent
    +
Consumer Agent
    +
QVAC delegated inference
    +
output hashing
    +
verification local
    +
small-model tool orchestration
    +
benchmark de reliability
```

Flujo:

```text
Browser
  │
  ▼
Consumer Agent
  │
  ║ QVAC P2P
  ▼
Provider Agent
  │
  ▼
LLM
  │
  ▼
Consumer Agent
  │
  ▼
Browser
```

El backend central solo recibe metadatos.

---

# 3. No debes esperar por los demás

Mientras B hace la API:

```text
MARKETPLACE_DISABLED=true
```

y pruebas con public keys manualmente.

Mientras C hace la web:

```bash
curl POST localhost:5050/v1/inference
```

Por eso puedes completar casi toda tu parte de forma independiente.

---

# 4. Lo primero que haces

## A0 — Diagnóstico

Antes de crear arquitectura:

```bash
qvac doctor
```

Comprobar:

- Node compatible;
- QVAC instalado;
- RAM;
- drivers;
- Vulkan/Metal;
- espacio libre.

Usar Node moderno compatible con la versión actual del SDK.

## A1 — Spike aislado

Crear temporalmente:

```text
spikes/
  provider.ts
  consumer.ts
```

Provider:

```ts
startQVACProvider()
```

Consumer:

```ts
loadModel({
  modelSrc: DEMO_MODEL,
  delegate: {
    providerPublicKey,
    timeout: 60_000,
    fallbackToLocal: false
  }
})
```

Después:

```ts
completion(...)
```

## Criterio A1

En dos equipos:

```text
Machine A → Machine B → output
```

No sigas con abstracciones si esto no funciona.

---

# 5. Modelos y spike Track 2

## 5.1 Spike P2P

Empieza con:

```text
LLAMA_3_2_1B_INST_Q4_0
```

para demostrar primero:

```text
Machine A → QVAC P2P → Machine B → output
```

## 5.2 Tool use

En paralelo, prueba localmente:

```text
QWEN3_1_7B_INST_Q4
```

con:

```ts
modelConfig: {
  ctx_size: 4096,
  tools: true
}
```

Objetivo del spike:

```text
model → toolCall → execute tool → role:tool → model → final
```

No esperes a que P2P esté perfecto para construir el orchestrator: inicialmente usa tools mock. Después conecta el mismo loop al modelId delegado.

## 5.3 Gate técnico H1

Antes de asumir que Track 2 está resuelto, comprobar en la versión de QVAC instalada:

- evento `toolCall` real;
- argumentos parseados;
- envío de tool result en history;
- segunda completion;
- combinación con delegated model;
- `fallbackToLocal=false` en demo remota.

Si una firma difiere de documentación, adaptar el `qvac-adapter`; nunca inventar métodos.

---

# 6. packages/qvac-adapter

Objetivo: aislar QVAC del resto.

Interfaz sugerida:

```ts
export interface QvacProviderService {
  start(options: ProviderStartOptions): Promise<{
    publicKey: string;
  }>;

  stop(): Promise<void>;
}

export interface QvacConsumerService {
  runDelegatedCompletion(
    input: DelegatedCompletionInput
  ): Promise<DelegatedCompletionResult>;
}
```

Input:

```ts
interface DelegatedCompletionInput {
  providerPublicKey: string;
  prompt: string;

  modelKey: string;

  timeoutMs: number;
  fallbackToLocal: boolean;
}
```

Output normalizado:

```ts
interface DelegatedCompletionResult {
  content: string;

  stats: {
    inputTokens?: number;
    outputTokens?: number;
    durationMs: number;
  };
}
```

Razón:

- C y B nunca importan QVAC directamente.
- Si cambia una firma del SDK, cambias un solo paquete.
- Puedes mockear `QvacConsumerService`.

---

# 7. Provider Agent

Ruta:

```text
apps/provider-agent/
```

Estructura sugerida:

```text
src/
  index.ts
  config.ts
  provider.ts
  marketplace-client.ts
  heartbeat.ts
  logger.ts
```

---

# 8. Flujo Provider Agent

```text
process start
   │
   ▼
load env
   │
   ▼
validate config
   │
   ▼
startQVACProvider
   │
   ▼
publicKey
   │
   ├──────────────► terminal
   │
   ▼
register marketplace
   │
   ▼
providerId/providerToken
   │
   ▼
heartbeat interval
   │
   ▼
process remains alive
```

---

# 9. Provider config

```env
MARKETPLACE_API_URL=http://localhost:4000

PROVIDER_NAME=Gaming-PC-01
PROVIDER_WALLET=0x...
PROVIDER_HARDWARE=RTX-4070

PROVIDER_MODEL_KEY=demo-llm
PROVIDER_MODEL_LABEL=Llama-3.2-1B-Q4

PROVIDER_PRICE_ATOMIC=2000

QVAC_HYPERSWARM_SEED=
```

---

# 10. Registro de provider

Enviar exactamente el contrato compartido:

```json
{
  "name": "Gaming-PC-01",
  "qvacPublicKey": "...",
  "walletAddress": "0x...",
  "modelKey": "demo-llm",
  "modelLabel": "Llama-3.2-1B-Q4",
  "hardwareLabel": "RTX-4070",
  "pricePer1kTokensAtomic": "2000"
}
```

Guardar en memoria:

```text
providerId
providerToken
```

No necesitas persistirlos inicialmente.

---

# 11. Heartbeat

Cada:

```text
10 segundos
```

POST:

```text
/v1/providers/:id/heartbeat
```

Header:

```text
Authorization: Bearer <providerToken>
```

Si falla:

- no apagar QVAC;
- log warning;
- reintentar.

---

# 12. Provider retry strategy

```text
API unavailable
   │
   ▼
wait 3s
   │
   ▼
retry register
```

Backoff simple es suficiente.

No dedicar tiempo a circuit breakers.

---

# 13. Logs Provider

Permitido:

```text
provider_started
provider_public_key
marketplace_registered
heartbeat_ok
heartbeat_failed
```

Prohibido:

```text
prompt
response
seed
wallet private key
providerToken
```

---

# 14. Consumer Agent

Ruta:

```text
apps/consumer-agent/
```

Estructura:

```text
src/
  index.ts
  server.ts
  config.ts
  inference-service.ts
  verification.ts
  hashing.ts
  marketplace-client.ts
  logger.ts
```

---

# 15. Consumer Agent HTTP

Escuchar:

```text
127.0.0.1:5050
```

No:

```text
0.0.0.0
```

Endpoints:

```text
GET /health
POST /v1/inference
```

---

# 16. GET /health

Response:

```json
{
  "status": "ok",
  "service": "consumer-agent",
  "qvacReady": true
}
```

C usará esto para detectar si el agente está abierto.

---

# 17. POST /v1/inference

Request:

```json
{
  "jobId": "job_123",
  "executionToken": "...",

  "provider": {
    "id": "p_001",
    "qvacPublicKey": "...",
    "modelKey": "demo-llm"
  },

  "prompt": "Return JSON only...",

  "verificationMode": "LOCAL_SCHEMA"
}
```

Opcional verifier:

```json
{
  "verifier": {
    "id": "p_002",
    "qvacPublicKey": "..."
  }
}
```

---

# 18. Flujo interno Consumer Agent

## Paso 1

No loguear body.

## Paso 2

Notificar central:

```text
CONNECTING
```

## Paso 3

QVAC:

```text
loadModel(delegate)
```

Usar:

```text
fallbackToLocal=false
```

durante demo.

Esto es crítico para probar que la ejecución fue remota.

## Paso 4

Notificar:

```text
RUNNING
```

## Paso 5

Ejecutar completion.

## Paso 6

Recolectar:

```text
content
duration
stats disponibles
```

## Paso 7

Normalizar output.

## Paso 8

SHA-256.

## Paso 9

Verificar.

## Paso 10

Enviar a central solo:

```text
outputHash
metrics
status
verification
```

## Paso 11

Responder raw output a browser.

---

# 18A. Reliability Orchestrator — tu parte nueva crítica

Ruta:

```text
apps/consumer-agent/src/reliability/
  orchestrator.ts
  tool-registry.ts
  tool-schemas.ts
  retry-policy.ts
  final-schema.ts
  grounding.ts
  trace.ts
```

El endpoint principal `/v1/inference` pasa por esta capa. No crear un endpoint de juguete desconectado del job real.

## Tools mínimas

```text
get_provider_status(providerId)
get_job_metadata(jobId)
calculate_expected_cost(inputTokens, outputTokens, pricePer1kTokensAtomic)
```

Las dos primeras llaman al Marketplace API. La tercera es determinista local.

## Tool registry

Cada tool debe declarar:

```ts
interface RegisteredTool<TArgs, TResult> {
  name: string;
  description: string;
  schema: ZodSchema<TArgs>;
  execute(args: TArgs, ctx: ToolContext): Promise<TResult>;
}
```

## Scope

Antes de ejecutar:

```ts
if (args.jobId && args.jobId !== ctx.jobId) reject('TOOL_SCOPE_VIOLATION');
if (args.providerId && args.providerId !== ctx.providerId) reject('TOOL_SCOPE_VIOLATION');
```

## Bounded loop

```text
MAX_TOOL_TURNS=4
MAX_TOOL_RETRIES=1
MAX_FINAL_SCHEMA_RETRIES=1
```

Pseudoflujo:

```text
for turn 1..MAX_TOOL_TURNS
  completion(history, tools)

  if final without tools
     validate final schema
     grounding check
     return

  for each toolCall
     whitelist
     scope
     zod args
     execute
       ├─ success → append role:tool
       └─ fail → retry once → if fail, refusal/failure

if no valid final
  MAX_TURNS
```

## Regla anti-hallucination

Nunca aceptar que el LLM simplemente diga que una tool devolvió algo.

Tú mantienes:

```ts
actualToolResults: Map<string, unknown>
```

y `grounding.ts` compara campos críticos del final contra esos resultados.

Ejemplo:

```text
actual expectedAmountAtomic = 2310
final  expectedAmountAtomic = 2800
```

Debe producir:

```text
GROUNDING_MISMATCH
```

## Refusal

Si falta evidencia:

```json
{
  "status": "INSUFFICIENT_EVIDENCE",
  "reason": "Required source could not be retrieved."
}
```

Nunca fabricar `ONLINE`, costos, jobs o quotes.

## Trace

Devuelve a C solo:

```text
turn
toolName
argsValid
executionStatus
durationMs
retryCount
errorCode?
```

No devolver raw prompt en el trace ni mandarlo al central.

---

# 18B. Benchmark Track 2

Archivo:

```text
scripts/reliability-benchmark.ts
```

Construye dataset sintético y reproducible con escenarios:

```text
NORMAL_CHAIN
NOT_FOUND
EMPTY_RESULT
INVALID_ARGS
TOOL_TIMEOUT
GROUNDING_CONFLICT
```

Dos modos:

```text
baseline
hardened
```

Mismo modelo, mismos prompts/tasks y mismos fixtures/failure injection.

Métricas calculadas desde runs reales:

```text
taskSuccessRate
toolSelectionAccuracy
validArgumentRate
groundedAnswerRate
correctRefusalRate
retryRecoveryRate
hallucinatedResultRate
averageToolTurns
averageLatencyMs
```

Outputs:

```text
artifacts/benchmark-results.json
artifacts/benchmark-failures.json
```

Objetivo: N>=20; ideal 30 si el tiempo/hardware lo permite.

No hardcodear porcentajes.

Failure codes:

```text
F1 WRONG_TOOL
F2 INVALID_ARGS
F3 IGNORED_TOOL_RESULT
F4 HALLUCINATED_RESULT
F5 TOOL_LOOP
F6 MAX_TURNS
F7 FINAL_SCHEMA_INVALID
F8 PROVIDER_TIMEOUT
F9 TOOL_SCOPE_VIOLATION
```

---

# 19. Normalización

Para la demo JSON:

```ts
function normalizeJsonOutput(text: string): string {
  const parsed = JSON.parse(extractJson(text));
  return JSON.stringify(parsed);
}
```

Para texto:

```ts
trim
normalize line endings
```

Evitar transformaciones agresivas.

---

# 20. Hash

```text
SHA-256
```

Resultado hexadecimal de 64 caracteres.

Función:

```ts
sha256(normalizedOutput)
```

También C puede calcular `promptHash` en browser.

---

# 21. Verification LOCAL_SCHEMA

MUST HAVE.

Ejemplo:

Prompt:

```text
Return JSON only:
{"answer": number}

Calculate 1947 * 82.
```

Validar:

1. parse JSON;
2. `answer` number;
3. valor esperado.

Resultado:

```text
PASSED
```

---

# 22. Verification REDUNDANT_DETERMINISTIC

SHOULD HAVE.

```text
same prompt
same model
Provider A
Provider B
```

Ejecutar desde Consumer Agent.

Después:

```text
hashA === hashB
```

Si sí:

```text
PASSED
```

Si no:

```text
FAILED
```

No enviar respuestas a central.

---

# 23. Generación determinista

Para minimizar diferencias:

- misma familia/modelo;
- prompt exacto;
- JSON only;
- temperatura baja/cero cuando corresponda;
- seed fijo cuando la API utilizada lo permita;
- sin texto creativo.

No uses una pregunta abierta para la prueba redundante.

---

# 24. Marketplace client

Tu cliente solo necesita:

```text
POST provider register
POST heartbeat
PATCH job progress
```

Debe poder desactivarse:

```env
MARKETPLACE_DISABLED=true
```

En modo disabled:

- imprimir estados localmente;
- no fallar inferencia.

---

# 25. Estado central que debes enviar

Secuencia:

```text
CONNECTING
RUNNING
VERIFYING
VERIFIED
```

Error:

```text
FAILED
```

No inventes nuevos estados.

---

# 26. Manejo de fallos

## Provider unreachable

Return:

```json
{
  "code": "PROVIDER_UNREACHABLE",
  "message": "Could not connect to the selected provider."
}
```

Central:

```text
FAILED
```

## Timeout

```text
INFERENCE_TIMEOUT
```

## Invalid output

```text
VERIFICATION_FAILED
```

## Marketplace unavailable

La inferencia puede terminar.

Después intentar sincronizar progreso.

Para 24 h basta con best effort.

---

# 27. Privacidad — reglas tuyas

Tu servicio es el que ve el prompt.

Por eso:

- no guardar prompts;
- no loguearlos;
- no analytics;
- no error dump con request body;
- no Sentry payloads;
- no archivos temporales.

Cuando termine request:

```text
prompt reference queda solo en memoria hasta GC
```

---

# 28. CORS

Consumer Agent:

```text
Access-Control-Allow-Origin: http://localhost:3000
```

No:

```text
*
```

Para demo.

---

# 29. Integración con C

Tú le entregas:

```text
GET /health
POST /v1/inference
```

y un ejemplo curl.

C no necesita saber cómo funciona QVAC.

Ejemplo:

```bash
curl -X POST http://127.0.0.1:5050/v1/inference \
  -H 'Content-Type: application/json' \
  -d '{...}'
```

---

# 30. Integración con B

Tú consumes:

```text
POST /providers/register
POST /providers/:id/heartbeat
PATCH /jobs/:id/progress
```

Hasta que B esté listo, usa un mock client.

---

# 31. Tu trabajo no es lineal

Mantén tres carriles simultáneos:

```text
CARRIL P2P             CARRIL RELIABILITY          CARRIL INTEGRACIÓN
qvac doctor            Qwen tool spike             mock marketplace client
provider/consumer      tool registry               HTTP localhost
remote completion      Zod/scope/retry             progress callbacks
stability              grounding/refusal           UI response shape
```

Si P2P se bloquea por red, no pares: avanza Reliability localmente.
Si B no está listo, usa fixtures.
Si C no está listo, prueba con curl.

---

# 32. Cronograma personal paralelo

## H0–H1

- `qvac doctor`;
- prueba mínima P2P entre dos equipos;
- prueba Qwen toolCall local;
- confirmar contratos.

## H1–H3

Carril 1:

- estabilizar delegated completion.

Carril 2:

- tool registry con mockExecute;
- final schema.

Carril 3:

- Consumer Agent skeleton `/health` + `/v1/inference`.

## H3–H6

- Provider Agent real;
- tool whitelist/scope;
- Zod tool args;
- trace;
- marketplace client mock/real.

## H6–H9

- unir delegated model + tool loop;
- retries;
- refusal;
- grounding;
- entregar response real a C.

## H9–H12

- failure injection;
- benchmark runner;
- primera corrida baseline/hardened;
- LOCAL_SCHEMA.

## H12–H16

- N>=20 runs reales objetivo;
- corregir fallos más frecuentes;
- provider restart/reconnect;
- documentar latency/model/hardware.

`REDUNDANT_DETERMINISTIC` solo si todo lo anterior ya está estable.

## H16–H18

- 5 E2E consecutivos;
- tool timeout;
- not found;
- invalid args;
- grounding mismatch;
- scope violation;
- privacidad.

## H18+

- no nuevas features;
- corrida benchmark final;
- generar artifacts;
- permalinks QVAC;
- ensayar demo.

---

# 33. Checkpoint H3

Debes mostrar al equipo:

```text
Machine 1
consumer.ts
   ↓
Machine 2
provider.ts
   ↓
real output
```

Si no:

todo el equipo debe considerar esto un bloqueo crítico.

---

# 34. Checkpoint H6

Provider real debe aparecer en API/Web.

Si B no está listo:

mostrar request generado y continuar.

---

# 35. Checkpoint H9

C debe poder hacer:

```text
browser
↓
localhost consumer agent
↓
provider real
↓
resultado browser
```

---

# 36. Definition of Done A

- [ ] `qvac doctor` validado.
- [ ] QVAC Provider arranca.
- [ ] public key obtenida.
- [ ] inferencia remota en otra máquina.
- [ ] `fallbackToLocal=false`.
- [ ] Provider se registra.
- [ ] heartbeat.
- [ ] Consumer `/health`.
- [ ] Consumer `/v1/inference`.
- [ ] raw output solo retorna localmente.
- [ ] SHA-256.
- [ ] LOCAL_SCHEMA verification.
- [ ] central recibe solo metadata.
- [ ] logs sin prompt.
- [ ] errores entendibles.
- [ ] 5 ejecuciones consecutivas.

---

# 37. Fallbacks tuyos

## Si segundo provider falla

Usa:

```text
LOCAL_SCHEMA
```

## Si marketplace falla

```text
MARKETPLACE_DISABLED=true
```

y public key manual.

## Si Qwen tool use falla

No quitar Track 2 silenciosamente. Primero probar otra small model compatible con tool calling documentado. Mantener el benchmark sobre un solo modelo final y registrar la decisión.

## Si delegated + tools falla en la versión instalada

Confirmar el comportamiento real del SDK. Si existe una limitación, documentarla y priorizar una ruta soportada por QVAC sin fingir tool calls. No sustituir QVAC por cloud AI.

## Si modelo elegido falla

Volver a modelo pequeño ya probado.

## Si conexión fría tarda

Calentar antes de demo.

## Si provider se reinicia

Reiniciar consumer antes de demo si es necesario.

---

# 38. Qué no debes desarrollar

No hagas:

- UI;
- SQLite;
- WDK;
- smart contracts;
- token;
- WebSocket;
- training;
- scheduling GPU;
- Docker;
- login.

Tu éxito se mide en:

```text
remote compute real
```

---

# 39. Handoff final

Entregar a B:

- formato register;
- formato heartbeat;
- estados enviados.

Entregar a C:

- local agent URL;
- request example;
- response example;
- error codes.

Entregar al equipo:

- comando provider;
- comando consumer;
- provider public key;
- hardware usado;
- modelo usado;
- pasos para calentar la conexión.


---

# 40. Entregables Track 2 tuyos al cierre

```text
apps/consumer-agent/src/reliability/*
scripts/reliability-benchmark.ts
artifacts/benchmark-results.json
artifacts/benchmark-failures.json
```

Para README entregar también:

- modelo exacto;
- quantization;
- hardware del consumer/provider;
- promedio de latencia observado;
- N real del benchmark;
- limitaciones encontradas;
- permalinks donde `loadModel`, `completion`, tool loop y `startQVACProvider` ocurren.
