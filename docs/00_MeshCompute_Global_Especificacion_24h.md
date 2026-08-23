# MeshCompute — Especificación global de implementación
## MVP de 24 horas · 3 integrantes en paralelo · QVAC P2P + Marketplace + Reliability Orchestrator + Verificación + WDK

> Documento maestro. Este archivo define arquitectura, requisitos, contratos, flujos, ownership, orden de integración y criterios de aceptación.
>
> Regla del proyecto: **los tres integrantes trabajan en paralelo**. Nadie debe esperar a que otro "termine su módulo" para comenzar. Las dependencias se desacoplan mediante contratos y mocks.

---

# 0. Resultado que debe existir al final de las 24 horas

El MVP debe demostrar este flujo real:

```text
                    ┌─────────────────────┐
                    │   Marketplace API   │
                    │   SOLO METADATOS    │
                    └──────────┬──────────┘
                               │
                        provider registry
                        jobs / reputation
                        payment status
                               │
              ┌────────────────┴─────────────────┐
              │                                  │
              ▼                                  ▼
        Web local                         Provider Agent
        Consumer UI                       QVAC Provider
              │                                  ▲
              │ prompt                           │
              ▼                                  │
      Consumer Agent ═════ QVAC P2P ═════════════╝
        localhost
              │
              │ resultado
              ▼
            Web UI
              │
              └──── SOLO hashes/estado/métricas ───► Marketplace API
```

Al final debe poder demostrarse:

1. Un Provider Agent arranca en una máquina.
2. QVAC publica su `publicKey`.
3. El provider se registra en MeshCompute.
4. La UI lo muestra como `ONLINE`.
5. El usuario escribe un prompt.
6. El prompt **no pasa por la API central**.
7. El navegador lo entrega al Consumer Agent local.
8. El Consumer Agent delega la inferencia al Provider por QVAC P2P.
9. El resultado vuelve al Consumer Agent y luego a la UI.
10. La API central recibe únicamente estados, hashes, métricas y costos.
11. El trabajo se verifica de forma básica.
12. Se actualiza reputación.
13. Se intenta/ejecuta settlement con WDK en testnet o modo demo.
14. La UI termina mostrando `VERIFIED` y `PAID`/`SIMULATED`.

---

# 0.1 Alineación QVAC Track 2 sin cambiar la lógica de negocio

MeshCompute mantiene exactamente su propuesta central:

```text
Marketplace de capacidad de inferencia
        ↓
descubrimiento de providers
        ↓
job
        ↓
QVAC P2P delegated inference
        ↓
verificación
        ↓
reputación
        ↓
settlement
```

No se agrega otro producto ni una segunda IA paralela. La mejora para Track 2 vive **dentro del Consumer Agent que ya ejecuta los jobs**.

```text
Consumer Agent
      │
      ▼
Reliability Orchestrator
      │
      ├── QVAC delegated completion
      ├── tool registry
      ├── validación estricta de argumentos
      ├── ejecución de tools
      ├── reintento controlado
      ├── grounding check
      ├── refusal cuando falta evidencia
      └── trace efímero para UI/benchmark
      │
      ▼
resultado verificado
```

Esto permite que MeshCompute demuestre los criterios específicos de Track 2:

- multi-step tool chaining;
- uso real de resultados de tools;
- structured-output enforcement;
- retries limitados;
- refusal ante datos faltantes;
- detección de respuestas que contradicen un tool result;
- medición repetible de éxito y fallos.

**Regla de submission:** QVAC permite entrar a un solo track del sponsor. El equipo implementa una arquitectura que soporta ambos enfoques, pero antes de enviar el proyecto elegirá el track cuyo demo y evidencia hayan quedado más fuertes. Para este paquete, la evidencia adicional se optimiza para **Track 2**.

## 0.2 Qué NO cambia

No se modifica:

- Provider Registry;
- modelo de precios;
- descubrimiento de nodos;
- job lifecycle de negocio;
- reputación;
- settlement WDK;
- privacidad del control plane;
- QVAC como capa real de inferencia;
- regla de que el prompt/output no se almacena en Marketplace.

## 0.3 Evidencia Track 2 obligatoria

El demo final debe poder mostrar, además del flujo comercial normal:

```text
small model
   ↓
tool call 1
   ↓
resultado real
   ↓
tool call 2
   ↓
resultado real
   ↓
tool call 3
   ↓
resultado real
   ↓
final answer
   ↓
schema + grounding validation
```

Y un benchmark reproducible:

```text
same model + same tasks
baseline vs hardened
N >= 20 runs objetivo
```

Las métricas nunca se inventan. El README y la UI solo muestran porcentajes obtenidos por ejecuciones reales.

---

# 1. Decisiones de arquitectura ya cerradas

Estas decisiones no deben reabrirse durante el hackathon salvo bloqueo técnico crítico.

## 1.1 Stack

| Parte | Tecnología |
|---|---|
| Monorepo | pnpm workspaces |
| Lenguaje | TypeScript |
| Frontend | Next.js + Tailwind CSS |
| API central | Node.js + Fastify o Express |
| Persistencia | SQLite |
| Validación | Zod |
| IA/P2P | `@qvac/sdk` |
| Runtime QVAC | Node.js |
| Modelo demo | Modelo pequeño cuantizado disponible en QVAC |
| Recomendado para spike P2P | `LLAMA_3_2_1B_INST_Q4_0` |
| Recomendado para tool-use Track 2 | `QWEN3_1_7B_INST_Q4` |
| Wallet | Tether WDK EVM |
| Pago | ERC-20 de test/demo |
| Red | EVM testnet configurable |
| Hash | SHA-256 |
| Actualización UI | polling; streaming es opcional |

## 1.2 Por qué existe un Consumer Agent

QVAC JS/TS se integra en Node/Bare/Expo. Para el MVP web no se intentará ejecutar QVAC directamente dentro del navegador.

El consumidor tendrá:

```text
Browser / Next UI
      │
      │ HTTP localhost
      ▼
Consumer Agent
Node.js + QVAC
      │
      │ P2P
      ▼
Provider Agent
```

Esto además preserva la regla de privacidad:

```text
PROMPT:
Browser → localhost → QVAC P2P → Provider

NO:
Browser → Marketplace API → Provider
```

## 1.3 Privacidad del MVP

### MeshCompute central NO puede recibir:

- prompt;
- respuesta generada;
- documentos del usuario;
- historial de conversación;
- contenido de inferencia.

### MeshCompute central SÍ puede recibir:

- `jobId`;
- `providerId`;
- `verifierProviderId`;
- `modelKey`;
- `promptHash`;
- `outputHash`;
- número de tokens o estimación;
- latencia;
- costo;
- estado;
- resultado de verificación;
- transaction hash;
- timestamps.

### Limitación reconocida

El provider que ejecuta la inferencia puede procesar/ver la entrada. El MVP **no** implementa TEE, confidential computing ni private inference criptográfica.

---

# 2. Principio de trabajo: integración por contratos, no por espera

La forma incorrecta:

```text
Integrante A termina
        ↓
Integrante B comienza
        ↓
Integrante C comienza
        ↓
integración al final
```

La forma correcta:

```text
                    CONTRATOS H0
                        │
           ┌────────────┼────────────┐
           │            │            │
           ▼            ▼            ▼
     Integrante A  Integrante B Integrante C
       QVAC/P2P       API/DB        Frontend
           │            │            │
       mocks API     mocks QVAC   mocks de ambos
           │            │            │
           └────────────┼────────────┘
                        ▼
                 integración gradual
```

Cada integrante debe poder desarrollar aunque los otros dos no tengan nada funcional todavía.

---

# 3. Estructura del repositorio

```text
meshcompute/
│
├── apps/
│   ├── web/                    # Integrante C
│   ├── marketplace-api/        # Integrante B
│   ├── consumer-agent/         # Integrante A
│   └── provider-agent/         # Integrante A
│
├── packages/
│   ├── contracts/              # congelar al inicio
│   ├── qvac-adapter/           # Integrante A
│   ├── payment-adapter/        # Integrante B
│   └── config/                 # configuración compartida mínima
│
├── scripts/
│   ├── seed-demo.ts
│   └── smoke-test.sh
│
├── docs/
│   ├── architecture.md
│   └── demo-script.md
│
├── .env.example
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

# 4. Ownership para evitar conflictos de Git

## Integrante A

Propietario exclusivo de:

```text
apps/consumer-agent/**
apps/provider-agent/**
packages/qvac-adapter/**
```

## Integrante B

Propietario exclusivo de:

```text
apps/marketplace-api/**
packages/payment-adapter/**
apps/marketplace-api/migrations/**
```

Además será **merge captain** en checkpoints.

## Integrante C

Propietario exclusivo de:

```text
apps/web/**
```

## Compartidos

```text
packages/contracts/**
packages/config/**
package.json
pnpm-workspace.yaml
.env.example
```

Regla:

- Se definen durante H0–H1.
- Después de H1 se consideran **congelados**.
- Si alguien necesita cambiar un contrato, se comunica primero.
- No hacer cambios silenciosos en DTOs compartidos.

---

# 5. Puertos estándar

| Servicio | Puerto |
|---|---:|
| Web | `3000` |
| Marketplace API | `4000` |
| Consumer Agent | `5050` |
| QVAC | gestionado por SDK/P2P |

Variables:

```env
WEB_URL=http://localhost:3000
MARKETPLACE_API_URL=http://localhost:4000
CONSUMER_AGENT_URL=http://localhost:5050
```

---

# 6. Módulos globales

El MVP se divide en 9 módulos funcionales. `M2R` es una capa interna del Consumer Agent, no un nuevo negocio ni un microservicio independiente.

```text
M0  Contratos y configuración
M1  Provider Agent
M2  Consumer Agent
M2R Reliability Orchestrator / Tool Use
M3  Marketplace / Provider Registry
M4  Job Orchestrator
M5  Verification
M6  Reputation
M7  Payments / WDK
M8  Frontend / Demo
```

No representan un orden lineal.

---

# 7. Grafo real de dependencias

```text
                         M0 CONTRATOS
                       /      |       \
                      /       |        \
                     ▼        ▼         ▼
              M1 Provider   M3 API     M8 Frontend
                   │       /    \         │
                   │      ▼      ▼        │
                   │    M4 Jobs  M6 Rep   │
                   │      │               │
                   ▼      │               ▼
              M2 Consumer │         UI con mocks
                   │      │               │
                   ▼      │               │
             M2R Reliability             │
             /   |    |   \              │
            ▼    ▼    ▼    ▼             │
          tools zod retry grounding ─────┘
                   │
                   ├────── M5 Verification
                   │
                   └────── M7 Settlement
```

Paralelización:

- `M1`, `M3` y `M8` empiezan prácticamente al mismo tiempo.
- `M2` empieza en cuanto A valide el spike QVAC.
- `M2R` puede desarrollarse con un modelo local y tools mock mientras se estabiliza la delegación P2P; luego se conecta al mismo adapter QVAC.
- `M4` empieza mientras B todavía construye Provider Registry.
- `M6` puede empezar usando jobs simulados.
- `M7` puede probarse con un provider y job ficticios.
- `M8` se construye íntegramente contra fixtures inicialmente.

---

# 8. M0 — Contratos compartidos

## Objetivo

Crear la "frontera" entre equipos.

Debe estar estable antes de integrar.

## Enumeraciones

```ts
export type ProviderStatus =
  | 'ONLINE'
  | 'OFFLINE'
  | 'BUSY';

export type JobStatus =
  | 'CREATED'
  | 'ASSIGNED'
  | 'CONNECTING'
  | 'RUNNING'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'VERIFICATION_FAILED'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'FAILED'
  | 'CANCELLED';

export type VerificationStatus =
  | 'NOT_REQUESTED'
  | 'PENDING'
  | 'PASSED'
  | 'FAILED';

export type PaymentStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'SIMULATED';
```

## ProviderPublicDTO

```ts
export interface ProviderPublicDTO {
  id: string;
  name: string;
  qvacPublicKey: string;
  walletAddress: string;
  modelKey: string;
  modelLabel: string;
  hardwareLabel: string;
  pricePer1kTokensAtomic: string;
  tokenSymbol: 'mUSDT';
  status: ProviderStatus;
  reputation: number;
  jobsCompleted: number;
  jobsFailed: number;
  lastSeen: string;
}
```

## ProviderRegisterRequest

```ts
export interface ProviderRegisterRequest {
  name: string;
  qvacPublicKey: string;
  walletAddress: string;
  modelKey: string;
  modelLabel: string;
  hardwareLabel: string;
  pricePer1kTokensAtomic: string;
}
```

## JobCreateRequest

No contiene prompt.

```ts
export interface JobCreateRequest {
  providerId: string;
  verifierProviderId?: string;
  modelKey: string;
  promptHash: string;
  consumerWallet?: string;
  quotedAmountAtomic?: string;
}
```

## JobCreateResponse

```ts
export interface JobCreateResponse {
  jobId: string;
  executionToken: string;
  provider: ProviderPublicDTO;
  verifier?: ProviderPublicDTO;
  status: 'CREATED';
}
```

## JobMetadataDTO

No contiene output.

```ts
export interface JobMetadataDTO {
  id: string;
  providerId: string;
  verifierProviderId?: string;
  modelKey: string;

  promptHash: string;
  outputHash?: string;

  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;

  quotedAmountAtomic?: string;
  settledAmountAtomic?: string;

  status: JobStatus;
  verificationStatus: VerificationStatus;
  paymentStatus: PaymentStatus;

  paymentTxHash?: string;

  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

## JobProgressPatch

```ts
export interface JobProgressPatch {
  status?: JobStatus;
  outputHash?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  verificationStatus?: VerificationStatus;
}
```

## Respuesta estándar de error

```ts
export interface ApiErrorDTO {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

## Contratos locales de reliability

Estos tipos pertenecen a la frontera **Web ↔ Consumer Agent** y no a la persistencia central.

```ts
export type ReliabilityFinalStatus =
  | 'PASSED'
  | 'REFUSED'
  | 'FAILED';

export interface ToolTraceItem {
  turn: number;
  toolName: string;
  argsValid: boolean;
  executionStatus: 'SUCCESS' | 'ERROR' | 'REJECTED';
  durationMs: number;
  retryCount: number;
  errorCode?: string;
}

export interface ReliabilitySummary {
  status: ReliabilityFinalStatus;
  requiredTools?: number;
  successfulTools: number;
  failedTools: number;
  retries: number;
  schemaPassed: boolean;
  groundingPassed: boolean;
  refusalReason?: string;
  trace: ToolTraceItem[];
}
```

**Privacidad:** `trace` no contiene prompt completo ni raw tool results. Solo nombres de tools, estados, tiempos, códigos de error y metadatos seguros para la demo.

---

# 9. Regla de privacidad aplicada al contrato

El schema central debe ser `.strict()`.

Ejemplo conceptual:

```ts
const JobCreateSchema = z.object({
  providerId: z.string(),
  verifierProviderId: z.string().optional(),
  modelKey: z.string(),
  promptHash: z.string().length(64),
  consumerWallet: z.string().optional(),
  quotedAmountAtomic: z.string().optional()
}).strict();
```

Si llega:

```json
{
  "providerId": "p1",
  "prompt": "dato privado"
}
```

la API debe rechazarlo.

Esto convierte la privacidad en una propiedad técnica, no solamente en una promesa.

---

# 10. M1 — Provider Agent

## Responsable

Integrante A.

## Objetivo

Convertir una máquina en un nodo de inferencia QVAC y publicarla en el marketplace.

## Entrada

Configuración local:

```env
MARKETPLACE_API_URL=http://localhost:4000
PROVIDER_NAME=Gaming-PC-01
PROVIDER_WALLET=0x...
PROVIDER_MODEL_KEY=demo-llm
PROVIDER_MODEL_LABEL=Llama-3.2-1B-Q4
PROVIDER_HARDWARE=RTX-4070
PROVIDER_PRICE_ATOMIC=2000
QVAC_HYPERSWARM_SEED=...
```

## Flujo

```text
START
  │
  ▼
validar configuración
  │
  ▼
comprobar entorno QVAC
  │
  ▼
startQVACProvider()
  │
  ▼
obtener publicKey
  │
  ▼
POST /providers/register
  │
  ▼
guardar providerId + providerToken
  │
  ▼
heartbeat cada 10 s
  │
  ▼
esperar trabajos P2P
```

## Requisitos

### PA-001

El agente debe iniciar QVAC Provider.

### PA-002

Debe imprimir la public key en terminal.

### PA-003

Debe registrarse automáticamente en Marketplace API.

### PA-004

Debe enviar heartbeat.

### PA-005

Debe tolerar que la API central no esté disponible al arrancar:

```text
QVAC puede seguir arriba
+
reintentar registro cada N segundos
```

### PA-006

No debe almacenar prompts.

### PA-007

No debe imprimir prompt completo en logs.

### PA-008

Debe permitir apagar el proceso limpiamente.

### PA-009

Debe soportar un modo:

```env
MARKETPLACE_DISABLED=true
```

para probar QVAC sin backend.

---

# 11. M2 — Consumer Agent

## Responsable

Integrante A.

## Objetivo

Ejecutar inferencia delegada desde la máquina del consumidor sin pasar contenido por la API central.

## API local

```text
GET  /health
POST /v1/inference
```

## Request local

Este endpoint sí recibe prompt porque está en `localhost`.

```ts
interface LocalInferenceRequest {
  jobId: string;
  executionToken: string;

  provider: {
    id: string;
    qvacPublicKey: string;
    modelKey: string;
  };

  verifier?: {
    id: string;
    qvacPublicKey: string;
  };

  prompt: string;

  verificationMode:
    | 'LOCAL_SCHEMA'
    | 'REDUNDANT_DETERMINISTIC'
    | 'NONE';
}
```

## Response local

```ts
interface LocalInferenceResponse {
  jobId: string;
  content: string;

  outputHash: string;

  stats: {
    inputTokens?: number;
    outputTokens?: number;
    durationMs: number;
  };

  verification: {
    mode: string;
    status: 'PASSED' | 'FAILED' | 'NOT_REQUESTED';
    verifierOutputHash?: string;
  };

  reliability: ReliabilitySummary;
}
```

## Flujo

```text
UI
 │
 │ POST localhost:5050/v1/inference
 │ prompt + provider public key
 ▼
Consumer Agent
 │
 ├── PATCH central → CONNECTING
 │
 ├── loadModel(delegate.providerPublicKey)
 │
 ├── PATCH central → RUNNING
 │
 ├── completion()
 │
 ├── recibe output
 │
 ├── SHA-256(output normalizado)
 │
 ├── verification local
 │
 ├── PATCH central → VERIFYING
 │
 ├── PATCH central → VERIFIED / FAILED
 │
 └── devuelve output SOLO a UI
```

## Requisitos

### CA-001

Debe escuchar solo en loopback:

```text
127.0.0.1:5050
```

No:

```text
0.0.0.0
```

### CA-002

Debe aceptar CORS exclusivamente desde la web demo local.

### CA-003

Debe conectarse usando `providerPublicKey`.

### CA-004

Debe usar timeout generoso en primera conexión.

### CA-005

Debe poder desactivar fallback local para la demo.

Objetivo:

```text
fallbackToLocal=false
```

para poder demostrar que el provider remoto realmente ejecutó el trabajo.

### CA-006

El resultado completo solo vuelve a la UI.

### CA-007

La API central recibe únicamente hash/estado/métricas.

### CA-008

Los logs no imprimen el prompt.

### CA-009

Si el provider falla:

```text
status = FAILED
```

y el usuario recibe error entendible.

---

# 11A. M2R — Reliability Orchestrator / Tool Use

## Responsable

Integrante A.

## Objetivo

Hacer que el mismo small model que ejecuta el job mediante QVAC pueda encadenar tools de forma auditable y que el sistema no acepte una respuesta inventada cuando una tool falla, devuelve vacío o contradice la salida final.

## Ubicación

```text
apps/consumer-agent/src/reliability/
  orchestrator.ts
  tool-registry.ts
  tool-schemas.ts
  final-schema.ts
  grounding.ts
  retry-policy.ts
  trace.ts
```

No crear otro servicio.

## Tool registry mínimo

### `get_provider_status`

Entrada:

```json
{"providerId":"p_001"}
```

Fuente real:

```text
Marketplace API → GET /v1/providers/:id
```

### `get_job_metadata`

Entrada:

```json
{"jobId":"job_123"}
```

Fuente real:

```text
Marketplace API → GET /v1/jobs/:id
```

### `calculate_expected_cost`

Entrada:

```json
{
  "inputTokens": 1200,
  "outputTokens": 340,
  "pricePer1kTokensAtomic": "2000"
}
```

Fuente real: función determinista local, sin LLM.

El equipo puede añadir una cuarta tool solo si las tres anteriores ya funcionan.

## Regla de seguridad de tools

El modelo no elige cualquier `jobId` o `providerId` arbitrario. El orchestrator conoce el contexto del job y valida:

```text
tool.args.jobId      == currentJob.id
tool.args.providerId == currentJob.providerId
```

Si no coincide:

```text
TOOL_SCOPE_VIOLATION
```

No ejecutar la llamada.

## Loop máximo

```text
MAX_TOOL_TURNS=4
MAX_TOOL_RETRIES=1
MAX_FINAL_SCHEMA_RETRIES=1
```

Nunca permitir loops infinitos.

## Flujo

```text
completion()
   │
   ├── content only ───────────────► final validation
   │
   └── toolCall
          │
          ▼
     whitelist check
          │
          ▼
       Zod args
       /      \
    invalid   valid
      │         │
 correction    ▼
   once     execute tool
                │
                ├── error → retry máximo 1
                │              │
                │              └── sigue error → REFUSED/FAILED
                │
                ▼
          append role:tool
                │
                ▼
            completion()
```

## Grounding obligatorio

Para tasks de benchmark/demo, el final debe ser JSON estricto y declarar los valores usados. Ejemplo:

```json
{
  "providerStatus": "ONLINE",
  "expectedAmountAtomic": "2310",
  "quoteConsistent": false,
  "evidence": [
    "get_provider_status",
    "get_job_metadata",
    "calculate_expected_cost"
  ]
}
```

El validator compara campos críticos contra los resultados reales almacenados en memoria por el Tool Runner.

Si:

```text
tool expectedAmountAtomic = 2310
model expectedAmountAtomic = 2800
```

resultado:

```text
GROUNDING_MISMATCH
```

No marcar el job como `VERIFIED` por ese resultado.

## Refusal policy

La salida debe negarse a concluir cuando falte evidencia necesaria.

Casos obligatorios:

- provider `NOT_FOUND`;
- job `NOT_FOUND`;
- tool timeout después del retry;
- tool devuelve payload inválido;
- falta un campo requerido para calcular costo;
- model agotó `MAX_TOOL_TURNS`.

Respuesta estructurada recomendada:

```json
{
  "status": "INSUFFICIENT_EVIDENCE",
  "reason": "Required job metadata could not be retrieved."
}
```

## Benchmark Track 2

Archivo:

```text
scripts/reliability-benchmark.ts
```

Debe ejecutar los mismos casos en dos modos:

```text
BASELINE
small model + tools
sin capas hardened adicionales

HARDENED
small model + whitelist + Zod + retry + max turns + final schema + grounding + refusal
```

Escenarios mínimos objetivo:

| Escenario | Runs objetivo |
|---|---:|
| chain normal de 3 tools | 10 |
| provider/job inexistente | 4 |
| tool devuelve vacío/inválido | 4 |
| argumentos incorrectos | 4 |
| timeout/retry | 4 |
| grounding conflict | 4 |

Si el tiempo no permite 30, ejecutar al menos **20 runs reales** distribuidos entre escenarios.

Métricas:

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

El benchmark guarda solo datasets sintéticos/controlados y métricas; nunca contenido privado de usuarios.

## Failure taxonomy

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

Los resultados finales del benchmark deben conservar al menos conteo por `failureCode`.

---

# 12. M3 — Marketplace / Provider Registry

## Responsable

Integrante B.

## Objetivo

Descubrir providers sin que QVAC tenga que implementar discovery de marketplace.

## Endpoints

```text
GET  /health

GET  /v1/providers
GET  /v1/providers/:id

POST /v1/providers/register
POST /v1/providers/:id/heartbeat
```

## Registro

```text
Provider Agent
   │
   ▼
POST /providers/register
   │
   ▼
validar DTO
   │
   ▼
upsert provider
   │
   ▼
generar providerToken
   │
   ▼
ONLINE
```

## Heartbeat

```text
Provider
   │ cada 10 s
   ▼
heartbeat
   │
   ▼
lastSeen = now()
```

Proceso periódico:

```text
now - lastSeen > 30 s
        │
        ▼
     OFFLINE
```

## Requisitos

- GET providers debe filtrar `ONLINE`.
- Nunca devolver `providerToken`.
- Registro repetido de misma `qvacPublicKey` debe hacer upsert.
- El provider token autentica heartbeat de forma ligera.
- Esto no es autenticación production-grade.

---

# 13. M4 — Job Orchestrator

## Responsable

Integrante B.

## Objetivo

Mantener el estado del trabajo sin almacenar su contenido.

## Endpoints

```text
POST  /v1/jobs
GET   /v1/jobs
GET   /v1/jobs/:id
PATCH /v1/jobs/:id/progress
```

## Creación

```text
Web
 │
 │ providerId + modelKey + promptHash
 ▼
POST /jobs
 │
 ▼
verificar provider ONLINE
 │
 ▼
calcular quote
 │
 ▼
crear job
 │
 ▼
generar executionToken
 │
 ▼
CREATED
```

## Transiciones válidas

```text
CREATED
  ↓
ASSIGNED
  ↓
CONNECTING
  ↓
RUNNING
  ↓
VERIFYING
  ├────► VERIFICATION_FAILED
  │
  ▼
VERIFIED
  ↓
PAYMENT_PENDING
  ├────► PAYMENT_FAILED
  │
  ▼
PAID
```

Error:

```text
CONNECTING/RUNNING → FAILED
```

## Regla

No permitir:

```text
PAID → RUNNING
VERIFIED → CREATED
FAILED → PAID
```

---

# 14. M5 — Verification

## Responsabilidad compartida

### Integrante A

Ejecuta la verificación que necesita contenido/output.

### Integrante B

Persiste únicamente:

- hashes;
- resultado;
- penalización/reputación.

## Modo MUST HAVE: LOCAL_SCHEMA

Para una demo matemática/JSON:

```text
output
  │
  ▼
parse JSON
  │
  ▼
validar schema
  │
  ▼
validar expected rule
```

Ejemplo:

```json
{
  "answer": 159654
}
```

## Modo SHOULD HAVE: REDUNDANT_DETERMINISTIC

```text
             prompt
              │
       ┌──────┴──────┐
       ▼             ▼
  Provider A      Provider B
       │             │
       ▼             ▼
    output A       output B
       │             │
       ▼             ▼
 normalize/hash   normalize/hash
       │             │
       └──────┬──────┘
              ▼
             ==
```

El Consumer Agent hace la comparación localmente.

La API central recibe:

```json
{
  "verificationStatus": "PASSED",
  "outputHash": "...",
  "verifierOutputHash": "..."
}
```

Nunca las respuestas.

## Importante

Esto se llama:

> redundant deterministic verification

No:

> cryptographic proof-of-computation

---

# 15. M6 — Reputation

## Responsable

Integrante B.

## Regla inicial

```text
base reputation = 100
```

Eventos:

| Evento | Cambio |
|---|---:|
| Job verificado y pagado | `+1` |
| Timeout / FAILED | `-5` |
| Verificación fallida | `-10` |

Clamps:

```text
0 <= reputation <= 100
```

Si se quiere mostrar crecimiento por éxito, usar base 90 o cambiar máximo. Para simplificar demo:

```text
base = 95
success = +1
```

## Requisito crítico

La reputación debe actualizarse una sola vez por job.

Usar:

```text
reputationAppliedAt
```

o flag equivalente para idempotencia.

---

# 16. M7 — Payment / WDK

## Responsable

Integrante B.

## Alcance

El MVP usa una wallet de tesorería de demo/testnet gestionada por el backend.

No se presenta como arquitectura final de custodia.

## Modos

```text
PAYMENT_MODE=SIMULATED
PAYMENT_MODE=TESTNET
```

## Flujo TESTNET

```text
VERIFIED
   │
   ▼
POST /jobs/:id/settle
   │
   ▼
validar idempotencia
   │
   ▼
buscar wallet provider
   │
   ▼
quoteTransfer()
   │
   ▼
account.transfer()
   │
   ▼
guardar txHash
   │
   ▼
PAID
```

## Flujo SIMULATED

```text
VERIFIED
   │
   ▼
settle
   │
   ▼
generar fake tx reference
   │
   ▼
paymentStatus=SIMULATED
```

La UI debe diferenciar claramente:

```text
PAID ON TESTNET
```

de:

```text
SIMULATED PAYMENT
```

## Requisitos

- No usar dinero real.
- Seed phrase únicamente en variable de entorno.
- Nunca exponer seed al frontend.
- Nunca guardar seed en SQLite.
- `settle` debe ser idempotente.
- Un doble click no puede pagar dos veces.

---

# 17. M8 — Frontend

## Responsable

Integrante C.

## Pantallas

### `/`

Landing mínima:

- qué es MeshCompute;
- CTA Marketplace.

### `/providers`

Cards:

- nombre;
- hardware;
- modelo;
- status;
- reputación;
- precio;
- botón `Run inference`.

### `/jobs/new?provider=...`

Elementos:

- provider seleccionado;
- modelo;
- textarea prompt;
- selector de verificación;
- precio estimado;
- botón Run.

### `/jobs/[id]`

Timeline:

```text
Created
Connecting
Running
Verifying
Verified
Payment pending
Paid
```

Además:

- resultado local;
- tiempo;
- tokens;
- hash;
- tx hash;
- provider.

### `/dashboard`

- providers online;
- jobs terminados;
- tasa de éxito;
- pagos demo;
- benchmark baseline vs hardened si existen resultados reales;
- failure counts por categoría Track 2.

## Privacidad visible en UI

Mostrar:

```text
Your prompt is sent directly to the selected compute provider.
MeshCompute does not store the prompt or AI response.
```

Y una aclaración:

```text
The selected provider processes the workload and may access its contents.
```

---

# 18. Base de datos

## Tabla `providers`

```sql
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  qvac_public_key TEXT NOT NULL UNIQUE,
  wallet_address TEXT NOT NULL,
  model_key TEXT NOT NULL,
  model_label TEXT NOT NULL,
  hardware_label TEXT NOT NULL,
  price_per_1k_tokens_atomic TEXT NOT NULL,

  status TEXT NOT NULL,
  reputation INTEGER NOT NULL DEFAULT 95,
  jobs_completed INTEGER NOT NULL DEFAULT 0,
  jobs_failed INTEGER NOT NULL DEFAULT 0,

  provider_token_hash TEXT NOT NULL,

  last_seen TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## Tabla `jobs`

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,

  provider_id TEXT NOT NULL,
  verifier_provider_id TEXT,

  model_key TEXT NOT NULL,

  prompt_hash TEXT NOT NULL,
  output_hash TEXT,
  verifier_output_hash TEXT,

  input_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,

  quoted_amount_atomic TEXT,
  settled_amount_atomic TEXT,

  status TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  payment_status TEXT NOT NULL,

  payment_tx_hash TEXT,

  execution_token_hash TEXT NOT NULL,

  reputation_applied_at TEXT,

  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,

  FOREIGN KEY(provider_id) REFERENCES providers(id)
);
```

## Tabla `payment_attempts`

```sql
CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  amount_atomic TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,

  FOREIGN KEY(job_id) REFERENCES jobs(id)
);
```

## Columnas prohibidas

No crear:

```text
prompt
input_text
response
output_text
conversation
document_content
```

---

# 19. Flujo completo: alta de provider

```text
Provider machine
     │
     ▼
pnpm provider:start
     │
     ▼
QVAC provider starts
     │
     ▼
publicKey
     │
     ▼
Marketplace register
     │
     ▼
providerId/token
     │
     ▼
heartbeat loop
     │
     ▼
Marketplace shows ONLINE
```

### Fallos

#### API central no disponible

- QVAC sigue corriendo.
- Reintentar registro.

#### QVAC no inicia

- No registrar provider como online.
- Mostrar error terminal.

---

# 20. Flujo completo: descubrimiento

```text
Web UI
  │
  ▼
GET /providers?status=ONLINE
  │
  ▼
Marketplace API
  │
  ▼
SQLite
  │
  ▼
Provider cards
```

No involucra QVAC todavía.

---

# 21. Flujo completo: creación e inferencia privada

```text
Usuario escribe prompt en browser
        │
        ├── SHA-256 local
        │
        ▼
POST central /jobs
{
 providerId,
 modelKey,
 promptHash
}
        │
        ▼
jobId + executionToken
        │
        ▼
POST localhost:5050/v1/inference
{
 jobId,
 executionToken,
 providerPublicKey,
 prompt
}
        │
        ▼
Consumer Agent
        │
        ├── central: CONNECTING
        │
        ├── QVAC loadModel(delegate)
        │
        ├── central: RUNNING
        │
        ├── completion()
        │
        ▼
Provider
        │
        ▼
AI result
        │
        ▼
Consumer Agent
        │
        ├── hash result
        ├── metrics
        ├── verify
        └── central: VERIFIED
        │
        ▼
Browser receives raw result
```

La API central jamás está en el camino del prompt.

---

# 22. Flujo completo: settlement

```text
Job VERIFIED
     │
     ▼
UI o Consumer Agent
POST /jobs/:id/settle
     │
     ▼
Marketplace API
     │
     ├── status == VERIFIED?
     ├── payment already done?
     └── provider wallet valid?
     │
     ▼
Payment Adapter
     │
   ┌─┴──────────────┐
   ▼                ▼
SIMULATED         TESTNET
   │                │
fake ref         WDK transfer
   │                │
   └──────┬─────────┘
          ▼
  payment status
          │
          ▼
 reputation update
```

---

# 23. Flujo completo: provider offline

```text
Heartbeat stops
      │
      ▼
30 sec threshold
      │
      ▼
provider OFFLINE
      │
      ▼
no new jobs
```

Un job ya corriendo:

- puede terminar;
- si timeout → `FAILED`.

---

# 24. Flujo completo: verificación redundante

```text
Consumer Agent
   │
   ├────────────► Provider A
   │                 │
   │                 ▼
   │              output A
   │
   └────────────► Provider B
                     │
                     ▼
                  output B

normalize(A)
normalize(B)

SHA256(A) == SHA256(B)
       │
    ┌──┴───┐
    ▼      ▼
 PASSED   FAILED
```

Para minimizar variabilidad:

- usar tarea determinista;
- output JSON estricto;
- temperatura baja/cero si la integración lo permite;
- seed fijo si está disponible;
- mismo modelo.

---

# 25. Modelos de demo recomendados

No comenzar con un modelo grande.

## Spike P2P

Primero validar conectividad con una constante pequeña y conocida:

```text
LLAMA_3_2_1B_INST_Q4_0
```

Objetivo:

```text
conectividad > calidad de modelo
```

## Demo Track 2

Para tool use, priorizar:

```text
QWEN3_1_7B_INST_Q4
```

con configuración equivalente a:

```ts
modelConfig: {
  ctx_size: 4096,
  tools: true
}
```

La documentación actual de QVAC usa este modelo en su ejemplo de tool calling. No cambiar a un modelo mayor hasta tener el benchmark estable. Si la combinación exacta de delegated inference + tools presenta un bloqueo en la versión instalada, validar primero el comportamiento contra el SDK real del hackathon y documentar cualquier limitación; no inventar métodos ni resultados.

---

# 26. Requisitos funcionales completos

## Providers

- RF-P01 Registrar nodo.
- RF-P02 Obtener public key QVAC.
- RF-P03 Publicar hardware.
- RF-P04 Publicar modelo.
- RF-P05 Publicar precio.
- RF-P06 Publicar wallet.
- RF-P07 Heartbeat.
- RF-P08 Marcar offline automáticamente.
- RF-P09 Listar providers online.
- RF-P10 Mostrar reputación.

## Jobs

- RF-J01 Seleccionar provider.
- RF-J02 Crear job sin prompt central.
- RF-J03 Generar job id.
- RF-J04 Generar execution token.
- RF-J05 Conectar P2P.
- RF-J06 Ejecutar inferencia.
- RF-J07 Devolver output localmente.
- RF-J08 Calcular output hash.
- RF-J09 Guardar métricas.
- RF-J10 Mostrar estados.
- RF-J11 Manejar timeout.
- RF-J12 Manejar provider offline.
- RF-J13 Pasar la ejecución principal por Reliability Orchestrator.
- RF-J14 Mantener tool trace solo en memoria/UI salvo métricas agregadas.

## Verification

- RF-V01 Validación local básica.
- RF-V02 Persistir status.
- RF-V03 No persistir raw output.
- RF-V04 Redundant verification opcional.
- RF-V05 Penalización por fallo.
- RF-V06 Validar argumentos de tools con Zod.
- RF-V07 Rechazar tools fuera de whitelist/scope.
- RF-V08 Grounding check contra resultados reales de tools.
- RF-V09 Refusal ante evidencia insuficiente.
- RF-V10 Limitar retries y tool turns.
- RF-V11 Benchmark baseline vs hardened reproducible.

## Payments

- RF-W01 Quote/amount.
- RF-W02 Wallet provider.
- RF-W03 Payment mode.
- RF-W04 Settlement idempotente.
- RF-W05 Guardar tx hash.
- RF-W06 Distinguir simulated/testnet.
- RF-W07 No usar fondos reales.

## Frontend

- RF-F01 Marketplace.
- RF-F02 Provider cards.
- RF-F03 New Job.
- RF-F04 Job Timeline.
- RF-F05 Resultado.
- RF-F06 Privacy notice.
- RF-F07 Error state.
- RF-F08 Dashboard.
- RF-F09 Payment status.
- RF-F10 Polling.
- RF-F11 Tool Trace.
- RF-F12 Reliability badges.
- RF-F13 BenchmarkCard con datos reales o estado 'not run'.

---

# 27. Requisitos no funcionales

## RNF-01 Privacidad

La API central no almacena contenido.

## RNF-02 Validación estricta

Schemas Zod `.strict()`.

## RNF-03 Resiliencia demo

Debe haber mocks/fallbacks.

## RNF-04 Tiempo de integración

Cada frontera debe ser HTTP/DTO estable.

## RNF-05 Observabilidad

Cada servicio imprime:

```text
timestamp
service
event
jobId/providerId
status
```

sin prompts.

## RNF-06 Idempotencia

- provider register;
- heartbeat;
- settlement;
- reputación.

## RNF-07 Seguridad mínima

Tokens scoped de demo.

## RNF-08 Configuración

Nada sensible hardcodeado.

## RNF-09 Compatibilidad QVAC

Antes del hackathon ejecutar diagnóstico del entorno.

## RNF-10 Demo reproducible

Comando único por aplicación.

## RNF-11 Evidencia sobre afirmaciones

No mostrar porcentajes, success rates ni mejoras si el benchmark no fue ejecutado realmente.

## RNF-12 Determinismo del evaluator

Las reglas de `grounding.ts`, costo, scope y schemas deben ser deterministas. El LLM no se auto-califica.

## RNF-13 Bounded agent loop

Todo loop agentic debe tener límites explícitos de turns, retries y timeout.

## RNF-14 Trace sanitizado

La UI puede visualizar decisiones de tools, pero no debe persistir prompts/raw outputs en el Marketplace central.

---

# 28. API central final

## Health

```http
GET /health
```

## Providers

```http
GET /v1/providers
GET /v1/providers/:id
POST /v1/providers/register
POST /v1/providers/:id/heartbeat
```

## Jobs

```http
POST /v1/jobs
GET /v1/jobs
GET /v1/jobs/:id
PATCH /v1/jobs/:id/progress
POST /v1/jobs/:id/settle
```

## Stats

```http
GET /v1/stats
```

---

# 29. API local final

```http
GET http://127.0.0.1:5050/health

POST http://127.0.0.1:5050/v1/inference
```

Opcional:

```http
POST /v1/inference/:jobId/cancel
```

---

# 30. Contrato de estados y UI

| Backend | UI |
|---|---|
| CREATED | Created |
| ASSIGNED | Provider selected |
| CONNECTING | Connecting P2P |
| RUNNING | Running remotely |
| VERIFYING | Verifying result |
| VERIFIED | Verified |
| VERIFICATION_FAILED | Verification failed |
| PAYMENT_PENDING | Settling payment |
| PAID | Paid |
| PAYMENT_FAILED | Payment failed |
| FAILED | Job failed |

---

# 31. Estrategia de mocks

## Mock para Integrante A

Además del marketplace mock, A debe tener fixtures deterministas para tool results (`provider`, `job`, `calculator`) y poder desarrollar `M2R` sin esperar a B.

Si B no está listo:

```env
MARKETPLACE_DISABLED=true
```

Provider y Consumer se prueban usando public key manual.

## Mock para Integrante B

Crear script:

```text
scripts/seed-demo.ts
```

que registre:

- 2 providers falsos;
- 3 jobs;
- un verified job.

Así puede desarrollar payments/reputation sin A.

## Mock para Integrante C

C recibe fixtures de `ReliabilitySummary`, `ToolTraceItem[]` y un `benchmark-result.json` de ejemplo claramente marcado como mock hasta que A entregue resultados reales.

Archivo:

```text
apps/web/src/mocks/demo-data.ts
```

con DTOs reales de `packages/contracts`.

Toggle:

```env
NEXT_PUBLIC_USE_MOCKS=true
```

Así C no espera por A ni B.

---

# 32. Plan de ramas

```text
main
feat/a-qvac
feat/b-control-plane
feat/c-web
```

No crear una rama por archivo.

Commits pequeños:

```text
feat(provider): start qvac provider
feat(api): add provider registry
feat(web): add provider cards
```

---

# 33. Cronograma paralelo detallado

La planificación es deliberadamente **no lineal**. Después de H1, cada persona tiene un camino ejecutable con mocks/fixtures propios.

## H0–H1 — congelar fronteras + spikes simultáneos

### Todos

- clonar repo;
- fijar puertos;
- fijar DTOs;
- fijar estados;
- acordar formato `ReliabilitySummary`;
- congelar estructura compartida.

### A

En paralelo:

```text
qvac doctor
spike provider ↔ consumer
spike QWEN tool call local
```

No esperar a B ni C.

### B

En paralelo:

```text
workspace
contracts
API skeleton
SQLite
provider/job fixtures
```

No esperar a QVAC.

### C

En paralelo:

```text
Next.js
/providers mock
/jobs/new mock
/jobs/[id] mock
ToolTrace mock
```

No esperar a endpoints reales.

---

## H1–H3 — tres verticales independientes

### A

Objetivos independientes:

```text
PC A → QVAC → PC B → response
```

y por separado:

```text
Qwen small model → tool call → mockExecute → final
```

### B

Objetivo:

```text
register provider
heartbeat
GET providers
GET provider/:id
POST job
GET job/:id
```

### C

Objetivo:

```text
/providers
/jobs/new
/jobs/[id]
/dashboard shell
```

todo con mocks tipados.

## CHECKPOINT H3

Solo validar contratos; no esperar features completas.

1. C renderiza fixtures compartidos.
2. A puede formar `ProviderRegisterRequest` y `ReliabilitySummary`.
3. B expone provider/job shape acordado.
4. Nadie cambia DTOs silenciosamente desde este punto.

---

## H3–H6 — construir en abanico

### A

- Provider Agent real.
- Consumer Agent HTTP.
- `reliability/tool-registry.ts` contra fixtures.
- Zod args.
- bounded tool loop.

### B

- Provider Registry estable.
- Job state machine.
- SQLite.
- execution tokens.
- endpoints read-only listos para tools.

### C

- provider list mock → API real cuando esté disponible.
- crear job con mock/real según flag.
- `ToolTrace.tsx` y `ReliabilityBadge.tsx` contra fixtures.

## CHECKPOINT H6

Primera integración parcial:

```text
Provider Agent → Marketplace API → Web
```

Y, aunque P2P todavía falle, debe existir:

```text
Reliability Orchestrator → mock tools → trace → Web mock
```

---

## H6–H9 — unir caminos sin bloquearse

### A

- delegated inference real;
- tools reales consumiendo GET de B si B está disponible;
- retry policy;
- final schema;
- grounding validator;
- refusal policy.

Si B no está disponible: seguir con fixtures.

### B

- verification metadata;
- reputation;
- payment adapter simulated;
- stats;
- tests de privacidad/idempotencia.

### C

- `Run inference` hacia localhost Agent;
- Job timeline polling;
- trace real si A está listo, mock si no;
- privacy notice.

## CHECKPOINT H9

Objetivo principal:

```text
Web → central Job → Consumer → QVAC Provider → result → Web
```

Objetivo Track 2 paralelo:

```text
Consumer → 3-tool chain → validated final
```

Estos dos caminos deben converger en el mismo `POST /v1/inference`, no ser dos productos separados.

---

## H9–H12 — evidencia antes que extras

### A

- estabilizar tool chain delegado;
- failure injection;
- benchmark runner;
- primera corrida baseline/hardened;
- `LOCAL_SCHEMA`.

`REDUNDANT_DETERMINISTIC` solo si sobra tiempo.

### B

- WDK/testnet spike;
- settlement;
- idempotencia;
- mantener SIMULATED funcional siempre.

### C

- transaction UI;
- failure states;
- benchmark card leyendo archivo/result endpoint local;
- job detail completo.

## CHECKPOINT H12 — E2E obligatorio

Debe existir:

```text
provider registration
+
web discovery
+
job create
+
remote QVAC inference
+
al menos una chain real de tools
+
result
+
schema/grounding status
+
VERIFIED o refusal explícito
```

Payment puede seguir `SIMULATED`.

Si esto no existe: detener features secundarias.

---

## H12–H16 — robustez paralela

### A

- ejecutar benchmark real N>=20 objetivo;
- corregir top failures;
- guardar JSON de resultados reales;
- provider restart/reconnect handling;
- segundo provider solo si lo principal está estable.

### B

- WDK real testnet si estable;
- reputation final;
- seed demo;
- revisar que DB no tenga contenido privado.

### C

- dashboard real;
- baseline vs hardened;
- failure taxonomy;
- polish sin ocultar fallos.

---

## H16–H18 — integración y pruebas cruzadas

Cada integrante prueba una parte ajena:

- A verifica que el control plane nunca reciba prompt.
- B ejecuta el flujo de UI como jurado.
- C apaga provider/Consumer Agent y valida errores.

Ejecutar:

- 5 jobs consecutivos;
- provider offline;
- tool timeout;
- tool invalid args;
- grounding mismatch fixture;
- payment failure;
- privacy network inspection.

---

## H18 — FEATURE FREEZE

```text
NO nuevas funcionalidades
NO refactors grandes
NO cambio de stack
NO nuevo tool salvo reemplazo de uno roto
NO cambiar modelo si el actual ya produce benchmark defendible
```

Solo bugs, medición, logs, fallback, UX y demo.

---

## H18–H21 — submission evidence

### A

- corrida benchmark final;
- exportar `benchmark-results.json`;
- anotar modelo, quantization, hardware, latencia;
- identificar líneas/permalinks de integración QVAC.

### B

- wallet/payment proof;
- seed reproducible;
- revisar README de setup desde clean clone.

### C

- grabar/ensayar recorrido visual;
- asegurar que UI diga `SIMULATED` si no es testnet real;
- asegurar que benchmark mock esté deshabilitado.

---

## H21–H24 — freeze de demo

- ensayo completo en hardware real;
- probar red venue/hotspot alternativo;
- guardar commit/tag `demo-final`;
- README final;
- video end-to-end local;
- no cambiar números del benchmark después de grabarlos.

---

# 34. Matriz de integración

| Integración | Dueño A | Dueño B | Dueño C | Checkpoint |
|---|---|---|---|---|
| Provider → API | implementa cliente | implementa endpoint | observa UI | H6 |
| API → Web | - | contrato | cliente UI | H6 |
| Web → Consumer Agent | endpoint local | - | cliente UI | H9 |
| Consumer → QVAC Provider | ambos en A | - | visualiza | H9 |
| Consumer → Job progress | cliente | endpoint | polling | H9 |
| Reliability tools → API | ejecuta tools | expone GET provider/job | visualiza trace | H9 |
| Reliability trace → Web | produce summary | - | renderiza | H9–12 |
| Benchmark | runner + resultados | fixtures/fallos API | comparación UI | H12–16 |
| Verification → reputation | genera resultado | persiste/aplica | muestra | H12 |
| Payment → UI | - | settle | muestra | H12–16 |

---

# 35. Pruebas mínimas

## T-01 Provider registration

Given agent running
When register
Then provider appears ONLINE.

## T-02 Heartbeat timeout

Given provider exists
When no heartbeat > threshold
Then OFFLINE.

## T-03 Privacy rejection

When central API receives:

```json
{"prompt":"secret"}
```

Then HTTP 400.

## T-04 Remote inference

Consumer and Provider on different machines.

Then result comes back.

## T-05 No fallback local

Apagar provider.

Then inference must fail, not silently execute locally.

## T-06 Job state

Invalid transition rejected.

## T-07 Payment idempotence

Call settlement twice.

Then only one attempt succeeds.

## T-08 Reputation idempotence

Re-run callback.

Then reputation changes once.

## T-09 Browser privacy

Inspect central network requests.

Prompt must not appear in requests to port `4000`.

## T-10 Local Agent missing

UI must show:

```text
Consumer Agent not running.
Start it with pnpm consumer:start
```

## T-11 Multi-step tool chain

Task requiere tres tools.

Then final solo puede pasar si las tres tools requeridas se ejecutaron y fueron usadas.

## T-12 Invalid tool args

Tool args no cumplen Zod.

Then no se ejecuta la tool con esos args; se permite como máximo una corrección según policy.

## T-13 Tool failure no hallucination

Tool falla después del retry.

Then final debe ser `REFUSED`/`FAILED`; nunca inventar el dato.

## T-14 Grounding mismatch

Tool devuelve `2310` y el modelo afirma `2800`.

Then `groundingPassed=false`.

## T-15 Scope violation

Modelo intenta consultar otro `jobId/providerId`.

Then `TOOL_SCOPE_VIOLATION` y tool no ejecutada.

## T-16 Max turns

Modelo entra en loop.

Then ejecución termina al alcanzar `MAX_TOOL_TURNS`.

## T-17 Benchmark reproducible

Given mismo dataset/version/model/config.

Then script produce JSON con conteos y tasas calculadas, no hardcodeadas.

## T-18 Baseline/Hardened

Ambos modos deben usar el mismo conjunto de tasks y el mismo modelo para que la comparación sea válida.

---

# 36. Observabilidad y logs

Formato sugerido:

```text
2026-08-21T20:10:22Z
[consumer-agent]
job=job_123
event=qvac_connected
provider=p_001
durationMs=1820
```

Nunca:

```text
prompt=...
response=...
seedPhrase=...
executionToken=...
providerToken=...
```

---

# 37. Variables de entorno

## Marketplace API

```env
PORT=4000
DATABASE_URL=./meshcompute.db
PAYMENT_MODE=SIMULATED
EVM_RPC_URL=
MOCK_TOKEN_ADDRESS=
TREASURY_SEED_PHRASE=
TOKEN_DECIMALS=6
PROVIDER_OFFLINE_AFTER_MS=30000
```

## Provider Agent

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

## Consumer Agent

```env
PORT=5050
MARKETPLACE_API_URL=http://localhost:4000
WEB_ORIGIN=http://localhost:3000
QVAC_HYPERSWARM_SEED=
QVAC_FIRST_CONNECT_TIMEOUT_MS=60000
QVAC_FALLBACK_TO_LOCAL=false
RELIABILITY_ENABLED=true
MAX_TOOL_TURNS=4
MAX_TOOL_RETRIES=1
MAX_FINAL_SCHEMA_RETRIES=1
RELIABILITY_BENCHMARK_MODE=hardened
```

## Web

```env
NEXT_PUBLIC_MARKETPLACE_API_URL=http://localhost:4000
NEXT_PUBLIC_CONSUMER_AGENT_URL=http://127.0.0.1:5050
NEXT_PUBLIC_USE_MOCKS=false
```

---

# 38. Comandos objetivo

```bash
pnpm install
```

API:

```bash
pnpm api:dev
```

Web:

```bash
pnpm web:dev
```

Provider:

```bash
pnpm provider:start
```

Consumer:

```bash
pnpm consumer:start
```

Seed demo:

```bash
pnpm demo:seed
```

Tests:

```bash
pnpm test
```

---

# 39. Checklist previa de QVAC

Antes de implementar UI real:

```bash
qvac doctor
```

Validar:

- Node compatible;
- sistema operativo compatible;
- drivers;
- Vulkan/Metal cuando aplique;
- RAM;
- disco;
- SDK instalado.

Para el MVP debe priorizarse un modelo pequeño.

La primera conexión P2P puede ser sensiblemente más lenta que las posteriores. Para la demo se debe calentar previamente la conexión.

---

# 40. Fallbacks oficiales

## Nivel 0 — Ideal

```text
2 providers reales
redundant verification
WDK testnet real
```

## Nivel 1

```text
1 provider real
local schema verification
WDK testnet
```

## Nivel 2

```text
1 provider real
local schema verification
payment simulated
```

Este nivel sigue siendo una demo válida.

## Nunca bajar de

```text
Provider real
+
QVAC P2P real
+
resultado remoto real
```

Esa es la prueba central del producto.

---

# 41. Definition of Done global

## QVAC

- [ ] Provider inicia.
- [ ] Public key visible.
- [ ] Consumer se conecta.
- [ ] Inferencia remota real.
- [ ] `fallbackToLocal=false` en demo.
- [ ] Small model con tool calling real.
- [ ] Tool result vuelve al modelo antes de respuesta final.

## Marketplace

- [ ] Provider register.
- [ ] Heartbeat.
- [ ] Online/offline.
- [ ] Jobs metadata.
- [ ] Estado válido.

## Privacy

- [ ] No prompt en DB.
- [ ] No output en DB.
- [ ] No prompt en logs centrales.
- [ ] Zod strict rechaza prompt.
- [ ] Browser central traffic no contiene prompt.

## Verification / Reliability

- [ ] Schema local.
- [ ] Hash output.
- [ ] Estado VERIFIED.
- [ ] Tool whitelist + scope.
- [ ] Zod tool args.
- [ ] bounded retries/turns.
- [ ] grounding check.
- [ ] refusal cuando falta evidencia.
- [ ] benchmark real baseline vs hardened.
- [ ] failure taxonomy registrada.

## Payment

- [ ] Modo SIMULATED funciona.
- [ ] TESTNET si se consiguió.
- [ ] No doble settlement.
- [ ] UI diferencia ambos modos.

## Web

- [ ] Providers.
- [ ] New job.
- [ ] Local Agent integration.
- [ ] Job detail.
- [ ] Timeline.
- [ ] Resultado.
- [ ] Privacy notice.
- [ ] Payment status.
- [ ] Tool trace.
- [ ] Reliability status.
- [ ] BenchmarkCard usa resultados reales o indica 'not run'.

## Demo

- [ ] 5 ejecuciones consecutivas.
- [ ] modelo descargado.
- [ ] providers calientes.
- [ ] fallback payment.
- [ ] pitch ensayado.
- [ ] modelo/quantization/hardware/latencia documentados.
- [ ] permalinks QVAC listos.
- [ ] setup probado desde clean clone.

---

# 42. Guion de demo

## 1. Mostrar Provider B

```bash
pnpm provider:start
```

Terminal:

```text
QVAC provider started
Public key: ...
Registered as provider: Gaming-PC-01
Heartbeat: OK
```

## 2. Marketplace

Actualizar `/providers`.

Debe aparecer el nodo.

## 3. Explicar privacidad

Mostrar:

```text
Marketplace stores metadata only.
Prompt and output do not pass through our central server.
```

## 4. Crear job

Prompt de demo Track 2 integrado al negocio:

```text
Analyze this MeshCompute job. Check the assigned provider status, retrieve the
job metadata, calculate the expected cost and report whether the recorded quote
is consistent. If any required source cannot be retrieved, do not guess.
```

El contexto `jobId/providerId` lo fija el Consumer Agent; el modelo no recibe permiso para consultar IDs arbitrarios.

## 5. Ejecutar

UI:

```text
CONNECTING
RUNNING
```

Señalar físicamente la máquina provider.

## 6. Resultado y tool trace

La UI debe mostrar la respuesta estructurada y el trace sanitizado:

```text
1 get_provider_status      PASSED
2 get_job_metadata         PASSED
3 calculate_expected_cost PASSED
Schema                     PASSED
Grounding                  PASSED
```

Si una tool falla, demostrar refusal en una segunda ejecución preparada.

## 7. Verificación

```text
VERIFIED
```

## 8. Pago

```text
PAID ON TESTNET
```

o:

```text
SIMULATED PAYMENT
```

sin ocultarlo.

## 9. Benchmark

Mostrar `baseline vs hardened` con números obtenidos realmente y al menos un failure case que el sistema capture.

## 10. Cierre

Mostrar reputación actualizada y remarcar que la misma infraestructura de marketplace ahora hace confiable el uso de small models, en vez de añadir una IA paralela.

---

# 43. Qué decir al jurado

> MeshCompute adds the missing economic and discovery layer around peer-to-peer AI inference. QVAC handles delegated inference between peers. MeshCompute handles provider discovery, jobs, verification metadata, reputation and settlement. On top of the same execution path, our Reliability Orchestrator makes small-model tool use measurable: every tool call is validated, bounded, grounded in its actual result, and refused when evidence is missing. We do not claim reliability; we benchmark it. AI prompts and outputs are not collected by the central marketplace.

---

# 44. Qué NO decir

No afirmar:

- "el provider no puede ver el prompt";
- "es confidential computing";
- "es trustless";
- "tenemos ZK proof of inference";
- "usamos USDT real" si es mock;
- "hacemos training distribuido";
- "dividimos modelos entre GPUs".

---

# 45. Roadmap post-hackathon

## V0.2

- selección automática;
- benchmarking real de hardware;
- pricing dinámico;
- streaming;
- múltiples modelos.

## V0.3

- escrow;
- staking;
- slashing;
- challenge jobs;
- sampling probabilístico.

## V1

- TEE;
- remote attestation;
- confidential workloads;
- mejor protección frente al provider.

## V2

- fine-tuning;
- batch jobs;
- distributed training;
- scheduling GPU avanzado.

---

# 45A. Evidencia que debe quedar en el repositorio para Track 2

```text
scripts/reliability-benchmark.ts
artifacts/benchmark-results.json
artifacts/benchmark-failures.json
README: model + quantization + hardware + latency
README: exact benchmark command
README: baseline vs hardened table
README: known failures / limitations
GitHub permalinks: loadModel/completion/tool loop/provider startup
```

No editar manualmente los resultados JSON después de generarlos. Si se necesita una versión legible, generar Markdown desde el JSON mediante script.

---

# 46. Referencias técnicas verificadas

QVAC:

- JS/TS SDK: https://docs.qvac.tether.io/js-ts-sdk/
- Delegated inference: https://docs.qvac.tether.io/p2p-capabilities/delegated-inference/
- System requirements: https://docs.qvac.tether.io/system-requirements/
- API reference: https://docs.qvac.tether.io/reference/api/

WDK:

- EVM wallet: https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm/
- ERC-20 transfer: https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm/guides/transfer-tokens/

---

## QVAC Track 2 — tool use

Documentación verificada el 21-08-2026:

- QVAC Text generation: `completion()` expone eventos `toolCall` y `toolError`; el ejemplo oficial de tool calling usa `QWEN3_1_7B_INST_Q4` con `modelConfig.tools=true`.
- QVAC Delegated inference: el consumer configura `loadModel({ delegate: { providerPublicKey, timeout, fallbackToLocal } })`; las operaciones de inferencia se invocan con las mismas APIs que local.
- SDK JS/TS: Node.js `>=22.17` según la documentación actual.

URLs para README:

```text
https://docs.qvac.tether.io/ai-capabilities/text-generation/
https://docs.qvac.tether.io/p2p-capabilities/delegated-inference/
https://docs.qvac.tether.io/js-ts-sdk/
```

La implementación final debe validarse contra la versión real instalada durante el hackathon. Si una combinación no está soportada, documentar el límite y ajustar el demo sin simular llamadas inexistentes.

---

# 47. Regla final de ejecución

Si hay una discusión sobre qué desarrollar, priorizar en este orden:

```text
1. P2P QVAC real
2. Provider visible en marketplace
3. Job desde UI
4. Resultado remoto
5. Privacidad central
6. Verification
7. Payment simulated
8. Payment testnet
9. Reputation
10. Polish
```

El proyecto no se evalúa por cantidad de módulos, sino por demostrar un flujo completo que funcione.
