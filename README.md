# MeshCompute

**Marketplace P2P de inferencia de IA con privacidad por diseño.** Conecta a
personas que necesitan ejecutar modelos de lenguaje (consumers) con personas que
tienen hardware disponible (providers), usando **QVAC P2P** para la inferencia
delegada, un plano de control que **jamás ve el prompt ni la respuesta**,
verificación del resultado, reputación y settlement con **WDK de Tether** en
testnet (o simulado).

```text
Browser -> Consumer Agent local -> QVAC P2P -> Provider remoto
   |                                  |
   +-> Marketplace API <--- solo hashes, estados y metricas
                              |
                              +-> pago SIMULATED o WDK_TESTNET
```

---

## Índice

1. [El problema que resuelve](#el-problema-que-resuelve)
2. [Cómo lo resuelve](#cómo-lo-resuelve)
3. [Ventajas](#ventajas)
4. [Arquitectura](#arquitectura)
5. [Estructura del monorepo](#estructura-del-monorepo)
6. [Herramientas y tecnologías](#herramientas-y-tecnologías)
7. [Requisitos e instalación](#requisitos-e-instalación)
8. [Flujo integrado (cómo ejecutarlo)](#flujo-integrado-cómo-ejecutarlo)
9. [Verificación y tests](#verificación-y-tests)
10. [Pagos: wallet real sin arriesgar fondos](#pagos-wallet-real-sin-arriesgar-fondos)
11. [Portales y economía de la demo](#portales-y-economía-de-la-demo)
12. [Reliability Orchestrator y Benchmark (Track 2)](#reliability-orchestrator-y-benchmark-track-2)
13. [Seguridad y privacidad](#seguridad-y-privacidad)
14. [Checklist de demo](#checklist-de-demo-h21)
15. [Documentación adicional](#documentación-adicional)

---

## El problema que resuelve

Ejecutar modelos de lenguaje hoy implica elegir entre dos malas opciones:

- **Nubes centralizadas** (OpenAI, proveedores cloud): el prompt del usuario —
  que puede contener datos personales, código propietario o información
  sensible — viaja y se almacena en servidores de terceros. Además el costo es
  alto y la capacidad está concentrada en pocos actores.
- **Solo local**: exige tener hardware potente propio; la mayoría de equipos no
  puede ejecutar modelos medianos o grandes con buena latencia.

Al mismo tiempo, existe una enorme cantidad de **hardware ocioso** (PCs gaming,
workstations) que podría ofrecer inferencia, pero no hay una forma confiable de:

1. **Descubrir** esos nodos y saber si están disponibles.
2. **Delegarles trabajo sin exponer el contenido** del prompt a un intermediario.
3. **Verificar** que el resultado devuelto es correcto y no una alucinación.
4. **Confiar** en nodos anónimos (reputación).
5. **Pagarles** de forma automática, auditable y sin riesgo.

Un problema adicional, específico de los LLM con herramientas (tool calling):
los modelos pequeños ejecutados en hardware doméstico fallan de formas
predecibles — inventan resultados, ignoran la salida de las tools, entran en
bucles o devuelven JSON malformado — y sin un orquestador que lo controle, el
marketplace pagaría por respuestas inválidas.

## Cómo lo resuelve

MeshCompute separa estrictamente el **plano de datos** (el contenido) del
**plano de control** (los metadatos):

- **El prompt nunca toca el servidor central.** El navegador entrega el prompt
  al **Consumer Agent**, un proceso local atado a `127.0.0.1:5050` (binding no
  configurable por diseño). Este lo delega directamente al provider remoto por
  **QVAC P2P** (transporte cifrado sobre HyperDHT, sin servidor en medio).
- **El Marketplace API solo recibe metadatos**: `promptHash` y `outputHash`
  (SHA-256), conteo de tokens, latencia, estados y montos. Los schemas Zod
  `.strict()` compartidos en `packages/contracts` **rechazan en tiempo de
  validación cualquier campo con contenido**, y hay tests que lo demuestran
  (`tests/privacy.test.ts`).
- **Ciclo de vida gobernado por una máquina de estados** con compare-and-set:
  `CREATED → ASSIGNED → CONNECTING → RUNNING → VERIFYING → VERIFIED →
  PAYMENT_PENDING → PAID`, con terminales `FAILED`, `CANCELLED`,
  `VERIFICATION_FAILED` y `PAYMENT_FAILED`. Cada job lleva un `executionToken`
  propio para reportar progreso.
- **Verificación en el lado del cliente**: `LOCAL_SCHEMA` (el output debe ser
  JSON válido conforme al esquema pedido) o `REDUNDANT_DETERMINISTIC` (el mismo
  prompt se envía a un segundo provider con `temperature: 0` y seed fija, y se
  comparan los hashes localmente).
- **Reliability Orchestrator** (Track 2): cuando el modelo soporta tool
  calling, el Consumer Agent ejecuta un loop acotado de herramientas con
  whitelist, validación estricta de argumentos (Zod `.strict()`), control de
  scope (el modelo no puede consultar jobs/providers ajenos), reintentos
  limitados, **grounding check** mecánico (recalcula el costo y compara la
  respuesta contra los resultados reales de las tools en vez de creerle al
  modelo) y **refusal estructurado** cuando falta evidencia. Los fallos se
  clasifican en una taxonomía F1–F9 medible.
- **Reputación real e idempotente**: `+1` por job pagado, `−5` por FAILED,
  `−10` por verificación fallida, con clamp 0–100 y aplicada una sola vez por
  job (columna `reputation_applied_at`).
- **Settlement automático y auditable**: al verificar, la API liquida sola
  (`AUTO_SETTLE=true`). Cada intento queda registrado en `payment_attempts`
  (un solo broadcast posible por job, protegido por transacción SQLite). El
  pago es `SIMULATED` por defecto o un transfer ERC-20 real en testnet vía
  **WDK de Tether**, con mainnet bloqueado por diseño, allowlist de chains y
  límites de monto y fee.

## Ventajas

- **Privacidad verificable, no prometida**: la imposibilidad de que el prompt
  pase por el backend está codificada en los schemas compartidos y cubierta por
  tests automáticos, no es solo una política.
- **Aprovecha hardware ocioso**: cualquier PC puede convertirse en nodo de
  inferencia con un comando (`pnpm provider:start`) y empezar a cobrar.
- **P2P real entre redes distintas**: QVAC/HyperDHT hace NAT traversal; los dos
  equipos no necesitan estar en la misma LAN para la inferencia.
- **Confianza sin autoridad central**: verificación del resultado + reputación
  acumulada + snapshot de precio congelado al crear el job (el provider no
  puede cambiar la tarifa a mitad de camino).
- **Pagos sin riesgo**: modo simulado por defecto; el modo testnet valida
  chain, montos y fees antes de cada broadcast, es idempotente y nunca expone
  la seed.
- **Resiliencia**: la inferencia termina aunque la API central esté caída
  (reporte de progreso best-effort); el provider reintenta el registro con
  backoff sin tumbar QVAC; sin fallback local silencioso
  (`QVAC_FALLBACK_TO_LOCAL=false`) para que un fallo remoto nunca se disfrace
  de éxito.
- **Honestidad medible**: el benchmark de reliability compara baseline vs
  hardened sobre inferencia delegada real y sus resultados viven en artifacts
  JSON que no se editan a mano.

## Arquitectura

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

### Componentes

| Componente | Puerto | Rol |
|---|---:|---|
| **Marketplace API** (`apps/marketplace-api`) | 4000 | Plano de control: registro de providers (upsert por public key QVAC, heartbeat 10 s, sweep OFFLINE a los 30 s), state machine de jobs con execution tokens, cuentas y portales, contratos, settlement, reputación y `/v1/stats`. Fastify 5 + SQLite (better-sqlite3, WAL, migraciones idempotentes). |
| **Consumer Agent** (`apps/consumer-agent`) | 5050 (solo loopback) | Único proceso que ve el prompt. Recibe la inferencia del navegador, la delega por QVAC P2P, hashea y verifica el output, ejecuta el Reliability Orchestrator y reporta solo metadatos. Un job a la vez. |
| **Provider Agent** (`apps/provider-agent`) | P2P (sin HTTP) | Convierte la máquina en nodo QVAC: publica su public key, se registra en el marketplace, envía heartbeats, ejecuta los modelos y pasa a BUSY mientras computa. |
| **Web** (`apps/web`) | 3001 | Next.js 16 (App Router, React 19, Tailwind 4): marketplace de nodos, creación de jobs con hash local del prompt, detalle con timeline y trace de tools, dashboard con benchmark, login y portales de provider/cliente. |

### Paquetes compartidos

| Paquete | Rol |
|---|---|
| `packages/contracts` | Frontera congelada entre todos los módulos: enums (12 estados de job), DTOs, taxonomía de fallos F1–F9 y schemas Zod `.strict()` que hacen imposible colar contenido al control plane. |
| `packages/qvac-adapter` | Único paquete que importa `@qvac/sdk`: provider, consumer con `loadModel({delegate})`, registro de 4 modelos (`demo-llm`, `tooluse-llm`, `local-tooluse-llm`, `local-vision-llm`), detección real de soporte de tools vía chat template del GGUF, resolución de modelos Ollama locales y mocks deterministas para tests. |
| `packages/payment-adapter` | `SimulatedPaymentAdapter` (default, riesgo cero) y `WdkEvmPaymentAdapter` (WDK de Tether: allowlist de 7 testnets, mainnet bloqueado, quote antes de transfer, caps de monto/fee, runtime inyectable para tests sin red). |
| `packages/config` | Único punto de lectura de `process.env`: `loadEnv(schema)` con Zod, helpers de parseo, logger con redacción de secretos y workarounds de Windows/Vulkan. |

### Flujo de un job (con pago automático)

```text
Web (hash local del prompt) → POST /v1/jobs (metadatos) → jobId + executionToken
Web → POST 127.0.0.1:5050/v1/inference (prompt)
Consumer → PATCH CONNECTING → QVAC loadModel(delegate) → PATCH RUNNING (provider BUSY)
Provider ejecuta → Consumer hashea + verifica → PATCH VERIFYING → PATCH VERIFIED
API: auto-settle → PAID → reputación +1 → saldos actualizados (provider ONLINE)
```

El contrato HTTP completo está en [`docs/openapi.yaml`](docs/openapi.yaml)
(verificado por test) y el detalle de la arquitectura en
[`docs/architecture.md`](docs/architecture.md).

## Estructura del monorepo

```text
apps/
  marketplace-api/   # Control plane (Fastify + SQLite)
  consumer-agent/    # Agente local del cliente (+ src/reliability/)
  provider-agent/    # Nodo de cómputo QVAC
  web/               # UI Next.js
packages/
  contracts/         # DTOs, enums y schemas Zod compartidos
  config/            # Carga y validación de env, logger
  qvac-adapter/      # Integración con @qvac/sdk y registro de modelos
  payment-adapter/   # Pagos SIMULATED / WDK testnet
docs/                # Especificación, arquitectura, guías, openapi.yaml
scripts/             # Benchmark, seed de demo, smoke tests, utilidades
spikes/              # Diagnóstico QVAC/P2P/GPU (doctor, nat-check, ...)
tests/               # Suite de integración raíz (privacidad, orchestrator, ...)
artifacts/           # Resultados del benchmark (JSON, no se editan a mano)
qvac/                # Worker Bare del consumer (consumer-worker.entry.mjs)
```

## Herramientas y tecnologías

| Área | Tecnología |
|---|---|
| Lenguaje / runtime | TypeScript 5.9 (ESM puro), Node.js ≥ 22.17, `tsx` como runner |
| Monorepo | pnpm 9.15 workspaces (`apps/*` + `packages/*`); los paquetes se consumen como TS fuente, sin paso de build |
| Inferencia P2P | `@qvac/sdk` 0.17 (delegated inference), HyperDHT 6.33, runtime Bare (worker en `qvac/`) |
| Modelos | Llama-3.2-1B-Instruct (q4_0), Qwen3-1.7B-Instruct (q4, tool-capable) del registry QVAC; Qwen3.5-4B y Qwen2.5-VL-3B vía Ollama local |
| Backend | Fastify 5 (+ `@fastify/cors`), better-sqlite3 12 (SQLite embebido, WAL, migraciones) |
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4, lucide-react, SweetAlert2 |
| Validación | Zod (v4 en la API, v3 en el resto — ojo al mover código entre paquetes) |
| Pagos | `@tetherto/wdk` + `@tetherto/wdk-wallet-evm` (WDK de Tether). No se usa viem ni ethers |
| Seguridad | scrypt + `timingSafeEqual` para contraseñas; tokens de sesión/provider guardados solo como SHA-256; redacción de headers sensibles en logs |
| Testing | Vitest 3 (unit + integración con SQLite `:memory:`), Testing Library + jsdom para la web |
| Utilidades | dotenv, cross-env, scripts PowerShell para provider remoto y fix de Vulkan |

## Requisitos e instalación

- Node.js 22.17 o superior
- pnpm 9.15

```bash
pnpm install
copy .env.example .env
```

El modo seguro por defecto usa `PAYMENT_MODE=SIMULATED`, no permite fallback de
inferencia local y usa el worker QVAC ligero en la PC consumer. `RELIABILITY_ENABLED=true`
es seguro con cualquier modelo: el Consumer Agent activa el Reliability
Orchestrator solo cuando el modelo del provider soporta tool calling
(`tooluse-llm`, `local-tooluse-llm`) y usa el camino simple con los demas
(`demo-llm`). El pago es automatico al verificar (`AUTO_SETTLE=true`); con
`SETTLE_BY_TOKENS=true` se liquida `ceil(tokens/1000) x tarifa` en vez del
precio fijo.

Para una demo con datos precargados (2 providers de seed y jobs en
RUNNING/VERIFIED/PAID):

```bash
pnpm demo:seed    # sembrar (idempotente)
pnpm demo:reset   # borrar la base y volver a sembrar (API detenida)
```

## Flujo integrado (cómo ejecutarlo)

En la PC del usuario, abre tres terminales:

```bash
pnpm api:dev
pnpm consumer:start
pnpm web:dev
```

En la PC que ejecuta el modelo, configura `PROVIDER_*`, `PROVIDER_WALLET` y
`MARKETPLACE_API_URL`, y ejecuta:

```bash
pnpm provider:start
```

`MARKETPLACE_API_URL` debe ser alcanzable desde la PC provider. En una LAN usa la
IP de la PC del backend; si las maquinas estan en redes o paises distintos,
ademas de QVAC necesitas exponer o tunelizar el puerto `4000` del control plane.
Para comprobar solamente el enlace QVAC P2P, usa `MARKETPLACE_DISABLED=true` y la
guia [Prueba en dos maquinas](docs/prueba-dos-maquinas.md).

La web queda en `http://127.0.0.1:3001`, el Consumer Agent local en
`http://127.0.0.1:5050` y la API en `http://127.0.0.1:4000`. Para mostrar solo la
UI sin procesos reales, configura `NEXT_PUBLIC_USE_MOCKS=true`; los datos
sinteticos permanecen marcados como mock.

Herramientas de diagnóstico: `pnpm qvac:doctor` (salud del stack QVAC),
`pnpm nat:check` (conectividad P2P), `pnpm models:check` (modelos disponibles).

## Verificación y tests

```bash
pnpm typecheck
pnpm test
pnpm web:build
```

La suite cubre, entre otros: la frontera de privacidad como propiedad testeable
(los schemas centrales rechazan `prompt`/`output`), el orchestrator completo
contra mocks deterministas (cadenas multi-step, args inválidos, scope
violations, loops, timeouts, refusals), hashing y normalización de outputs,
state machine, reputación idempotente, settlement sin doble broadcast, portales
y contratos, y los adapters de pago (incluido el bloqueo duro de mainnet).

Con la API corriendo, ejecuta el smoke test de integración (sin pagos) contra
una base desechable o de demo:

```bash
pnpm api:smoke
```

Configura `MARKETPLACE_API_URL` para apuntar a otra maquina. El smoke crea un
provider y un job, pero nunca imprime sus tokens.

## Pagos: wallet real sin arriesgar fondos

`PAYMENT_MODE=SIMULATED` es el valor sin riesgo. Para la demo evaluada, el backend
puede usar `WDK_TESTNET` y enviar un token ERC-20 de prueba a la wallet externa
del provider. Los chain IDs de mainnet se rechazan, transferencias y fees tienen
limites, cada intento es idempotente y auditable, y la seed nunca sale del backend.

Testnets permitidas: BNB testnet (97), Polygon Amoy (80002), Base Sepolia
(84532), Arbitrum Sepolia (421614), Avalanche Fuji (43113), Ethereum Sepolia
(11155111) y Optimism Sepolia (11155420).

Tras configurar y arrancar la API, se puede demostrar una transferencia
end-to-end en testnet, confirmada explícitamente:

```powershell
$env:PAYMENT_TEST_RECIPIENT='0x...'
$env:CONFIRM_TESTNET_TRANSFER='YES'
pnpm api:payment-smoke
```

El script exige confirmacion explicita, no imprime la seed ni tokens de API y
muestra el hash de testnet para comprobarlo en el explorador. Nunca se ejecuta
automaticamente durante los tests. Detalles en
[docs/testnet-payments.md](docs/testnet-payments.md).

## Portales y economía de la demo

Ademas del flujo anonimo, la web incluye cuentas con dos roles
(`/login`, email + contraseña con scrypt, sesiones Bearer de 7 días):

- **Portal del proveedor** (`/portal/provider`): publica una o varias maquinas
  (public key QVAC, descripcion del modelo, precio, wallet) sin necesidad de
  heartbeat, y gestiona contratos entrantes. El saldo muestra lo cobrado por
  todas sus maquinas.
- **Portal del cliente** (`/portal/client`): contrata maquinas y arranca con un
  credito demo de 100 mUSDT; cada job pagado con sesion iniciada descuenta de
  ese saldo.

Los contratos siguen el ciclo `REQUESTED → ACCEPTED | REJECTED | CANCELLED`,
con expiración automática a `EXPIRED` según `CONTRACT_TTL_MS`, y congelan el
precio al momento de solicitarse. Las máquinas publicadas por portal
(`source='PORTAL'`) son inmunes al barrido OFFLINE.

La reputacion es real e idempotente: `+1` por job pagado, `-5` por FAILED,
`-10` por verificacion fallida (clamp 0..100), aplicada una sola vez por job.

## Reliability Orchestrator y Benchmark (Track 2)

El orchestrator (`apps/consumer-agent/src/reliability/`) endurece la inferencia
delegada con tool calling:

- **Whitelist de 3 tools**: `get_provider_status`, `get_job_metadata` (leen el
  Marketplace API) y `calculate_expected_cost` (determinista local). Cadena
  obligatoria: whitelist → scope check → Zod `.strict()` → ejecución con timeout.
- **Política acotada**: `MAX_TOOL_TURNS=4`, `MAX_TOOL_RETRIES=1`, timeout de
  tool de 10 s, detección de loops por firma de llamada.
- **Salida estructurada** forzada con GBNF (respuesta final o refusal
  `INSUFFICIENT_EVIDENCE`, ambas `.strict()`).
- **Grounding check**: recalcula costo y consistencia contra los resultados
  reales de las tools; detecta respuestas que ignoran (F3) o alucinan (F4)
  resultados.
- **Taxonomía de fallos F1–F9** medible: WRONG_TOOL, INVALID_ARGS,
  IGNORED_TOOL_RESULT, HALLUCINATED_RESULT, TOOL_LOOP, MAX_TURNS,
  FINAL_SCHEMA_INVALID, PROVIDER_TIMEOUT, TOOL_SCOPE_VIOLATION.

El benchmark compara el mismo modelo y dataset en dos modos (baseline vs
hardened) sobre inferencia delegada QVAC real. Los resultados NO se editan a
mano: viven en `artifacts/benchmark-results.json` y
`artifacts/benchmark-failures.json`, y la tabla legible se regenera con
`pnpm benchmark:report` (RNF-11 / §45A).

Comando exacto utilizado (provider local Qwen3-1.7B, CPU):

```powershell
# 1) provider con modelo tool-capable (en este equipo Vulkan se cuelga: usar CPU)
$env:GGML_DISABLE_VULKAN='1'; $env:PROVIDER_MODEL_KEY='tooluse-llm'; pnpm provider:start
# 2) benchmark real delegado (60 runs: 30 baseline + 30 hardened, seed 42)
$env:GGML_DISABLE_VULKAN='1'
pnpm benchmark -- --adapter real --key <providerPublicKey> --model tooluse-llm
```

- Modelo: `QWEN3_1_7B_INST_Q4` (Qwen3-1.7B-Instruct, q4, registry oficial QVAC)
- Hardware del provider: AMD Ryzen 5 4600H (CPU; `GGML_DISABLE_VULKAN=1`),
  19.4 GB RAM, Windows 11
- Politica: `MAX_TOOL_TURNS=4`, `MAX_TOOL_RETRIES=1`, timeout tool 15 s
- Escenarios (doc 00 §11A): 10 chain normal + 4 NOT_FOUND + 4 vacio/invalido +
  4 args incorrectos + 4 timeout/retry + 4 grounding conflict

<!-- BENCHMARK_TABLE_START -->
_Tabla pendiente: ejecutar `pnpm benchmark:report` tras la corrida y pegar la
salida aqui._
<!-- BENCHMARK_TABLE_END -->

Referencias de integracion QVAC (permalinks relativos):

- `packages/qvac-adapter/src/consumer.ts` — `loadModel({ delegate })` y `completion()`
- `apps/consumer-agent/src/reliability/orchestrator.ts` — tool loop acotado
- `apps/provider-agent/src/index.ts` — arranque del provider QVAC

## Seguridad y privacidad

- **RNF-01**: el prompt y el output nunca pasan por el puerto 4000; solo viajan
  hashes SHA-256 (64 hex), tokens, latencia, estados y montos. Verificado por
  `tests/privacy.test.ts` y `apps/web/test/privacy-boundary.test.ts`.
- El Consumer Agent solo escucha en `127.0.0.1` (constante, no configurable) y
  usa CORS de origen exacto — nunca `*`.
- Contraseñas con scrypt (salt 16 B, clave 64 B) y comparación en tiempo
  constante; tokens de sesión y de provider almacenados solo como SHA-256.
- Logs con redacción de `Authorization` y `X-Execution-Token`; el Consumer
  Agent desactiva el logging de requests para no volcar el prompt.
- `bodyLimit` de 64 KB en la API; los errores 5xx nunca filtran mensajes
  internos.
- Montos siempre en `BigInt`/strings atómicos — sin floats en toda la economía.
- La seed de la treasury nunca sale del backend; mainnet está bloqueada por
  código, no por configuración.

## Checklist de demo (H21)

- [ ] `pnpm demo:reset` + servicios arriba (`api`, `consumer`, `web`, provider)
- [ ] Conexion P2P precalentada (una inferencia de prueba; la primera tarda 15-45 s)
- [ ] 5 jobs consecutivos sin fallo el mismo dia
- [ ] `artifacts/benchmark-results.json` presente y dashboard sin "NOT RUN"
- [ ] Setup probado desde clean clone (`pnpm install` -> 4 comandos)
- [ ] Tag `demo-final` creado; video grabado
- [ ] Guion: [docs/demo-script.md](docs/demo-script.md)

## Documentación adicional

- [Especificación global (MVP 24 h)](docs/00_MeshCompute_Global_Especificacion_24h.md)
- [Arquitectura (estado real)](docs/architecture.md)
- [Contrato HTTP OpenAPI](docs/openapi.yaml)
- [Guion de demo](docs/demo-script.md)
- [Backend Core (handoff Persona B)](docs/backend-core-handoff.md)
- [Agentes QVAC (handoff Persona A)](docs/handoff-A.md)
- [Pagos WDK en testnet](docs/testnet-payments.md)
- [Prueba en dos máquinas](docs/prueba-dos-maquinas.md)
- [Hallazgos y limitaciones del SDK QVAC](docs/qvac-findings.md)
- [Web de Persona C](apps/web/README.md)
