# Gate técnico H1 — firmas reales de `@qvac/sdk@0.17.1`

> Doc 01 §5.3: *"Si una firma difiere de documentación, adaptar el `qvac-adapter`; nunca inventar métodos."*
>
> Este documento es la **única** fuente contra la que se escribe `packages/qvac-adapter`.
> Verificado el 2026-08-22 leyendo los `.d.ts` y `.js` instalados, no la web.

## Entorno validado

| Dato | Valor |
|---|---|
| SDK | `@qvac/sdk@0.17.1` |
| Node | v24.19.0 (el SDK exige `>=22.17`) OK |
| Plataforma | Windows 11 (10.0.26200) x64 |
| CPU | AMD Ryzen 5 4600H, 6 físicos / 12 lógicos |
| RAM | 19.4 GB |
| GPU devices | 1 iGPU AMD Radeon detectada — **Vulkan se cuelga al cargar modelos**; se fuerza CPU con `GGML_DISABLE_VULKAN=1` (ver sección abajo) |
| Arranque worker (en caliente) | ~5 s |

La instalación en Windows funcionó sin toolchain nativo: los prebuilds vienen en el paquete
(**riesgo #1 del plan descartado**).

### Arranque en frío del worker Bare

El **primer** `getSystemResources()` / `loadModel()` tras instalar falla con:

    RPC initialization timed out after 30000ms — the worker process may have failed to start

No es un fallo real: el runtime Bare extrae sus prebuilds nativos la primera vez y excede el
timeout de 30 s. El segundo intento arranca en ~5 s. **Consecuencia operativa**: `pnpm qvac:doctor`
debe ejecutarse una vez en cada máquina antes de la demo, y tanto el Provider como el Consumer
Agent necesitan un warmup explícito al arrancar (doc 00 §39).

---

## Superficie confirmada

```ts
import {
  startQVACProvider, stopQVACProvider,
  loadModel, completion, unloadModel,
  cancel, getSystemResources,
} from '@qvac/sdk';
import { LLAMA_3_2_1B_INST_Q4_0, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk/models';
```

### Provider

```ts
startQVACProvider(params?: { firewall?: { mode: 'allow' | 'deny'; publicKeys: string[] } }):
  Promise<{ type: 'provide'; success: boolean; error?: string; publicKey?: string }>

stopQVACProvider(): Promise<{ type: 'stopProvide'; success: boolean; error?: string }>
```

- **Idempotente**: llamarlo dos veces devuelve la misma public key.
- La keypair se controla con la env var `QVAC_HYPERSWARM_SEED` → public key estable entre reinicios.
- `success` puede ser `false` **sin lanzar excepción**: hay que comprobarlo (PA-001).
- `stopQVACProvider` no libera el `swarm.listen()`; los sockets entrantes se destruyen pero la
  key sigue anunciada en la DHT.

### Delegación (`schemas/delegate.js`)

```ts
delegate?: {
  providerPublicKey: string;   // hex de 64 chars — ed25519 de 32 bytes (regex enforced)
  timeout?: number;            // ms, min 100
  healthCheckTimeout?: number; // ms, min 100 — sonda previa a delegar
  fallbackToLocal?: boolean;   // default false  <- ya es el default que exige CA-005
  forceNewConnection?: boolean;// default false
}
```

`delegate` va en **`loadModel`**, no en `completion`. El `modelId` devuelto queda ligado al
provider remoto; las llamadas siguientes usan ese `modelId` y reutilizan el socket abierto.

> `providerPublicKey` se valida contra `/^[0-9a-fA-F]{64}$/`. Un typo al copiar la key da un
> error de validación Zod, no un timeout — conviene validar antes en el Consumer Agent.

### `loadModel`

```ts
loadModel(options: {
  modelSrc: ModelDescriptor | string;  // descriptor del registry, ruta local, URL o pear://
  modelType?: string;                  // inferido del descriptor
  modelConfig?: { ctx_size?: number; tools?: boolean; ... };
  onProgress?: (p) => void;            // progreso de descarga
  delegate?: {...};
  logger?: Logger;
}): Promise<string> & { requestId: string }   // resuelve al modelId
```

### `completion`

```ts
completion(params: {
  modelId: string;
  history: Array<{ role: string; content: string; attachments?: ... }>;
  stream: boolean;
  tools?: Tool[] | ToolInput[];
  generationParams?: { temp?, top_p?, top_k?, seed?, predict?, reasoning_budget?, ... };
  captureThinking?: boolean;
  toolDialect?: 'hermes'|'pythonic'|'json'|'harmony'|'qwen35'|'gemma4'|'dsml';
  responseFormat?: { type: 'text' } | { type: 'json_object' }
                 | { type: 'json_schema'; json_schema: { name, schema, ... } };
  requestId?: string;
}): CompletionRun
```

```ts
type CompletionRun = {
  requestId: string;                          // para cancel({ requestId })
  events: AsyncIterable<CompletionEvent>;     // API canónica
  final: Promise<CompletionFinal>;
  // legacy deprecado: tokenStream, text, toolCalls, stats
};

type CompletionFinal = {
  contentText: string;        // <- NO `content`
  thinkingText?: string;
  toolCalls: ToolCallWithCall[];
  stats?: CompletionStats;
  stopReason?: 'eos' | 'length' | 'stopSequence' | 'cancelled' | 'error';
  raw: { fullText: string };
  cacheableAssistantContent?: string;
};

type CompletionStats = {
  promptTokens?: number;      // <- inputTokens
  generatedTokens?: number;   // <- outputTokens (n_eval)
  emittedTokens?: number;
  timeToFirstToken?: number;
  tokensPerSecond?: number;
  backendDevice?: 'cpu' | 'gpu';
};
```

Eventos: `contentDelta`, `rawDelta`, `thinkingDelta`, `toolCall`, `toolError`,
`completionStats`, `completionDone`.

### Tools

```ts
// ToolInput — acepta Zod directamente
type ToolInput = {
  name: string;
  description: string;
  parameters: z.ZodObject<...>;
  handler?: (args: Record<string, unknown>) => Promise<unknown>;  // OPCIONAL
};

// evento toolCall
event.call = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;  // <- YA PARSEADO como objeto, no string JSON
  raw?: string;
};

// evento toolError
event.error = { code: 'PARSE_ERROR' | 'VALIDATION_ERROR' | 'UNKNOWN_TOOL'; message; raw? };
```

Append de resultado al history: `{ role: 'tool', content: <string> }`. El schema declara
`role: z.string()` libre y **no existe `tool_call_id`** en el mensaje — otra incógnita del gate
resuelta.

---

## Decisiones que estos hallazgos fuerzan

### 1. Loop manual, no handlers del SDK

`handler` es **opcional** en `ToolInput`, y `final.toolCalls[].invoke()` sólo ejecuta si el
caller lo pide. Es decir: el SDK **no** ejecuta nada por su cuenta si omitimos `handler`.

Declaramos los tools **sin `handler`**, consumimos el evento `toolCall`, y el orchestrator
decide. Esto da control total de whitelist → scope → Zod → retry, que es exactamente lo que el
benchmark Track 2 mide. **La ruta primaria del plan es viable sin adaptaciones.**

### 2. `responseFormat` es mutuamente excluyente con `tools`

Verificado en `refineNoToolsWithStructuredOutput` (`schemas/completion-stream.js`):

    responseFormat (json_object/json_schema) cannot be combined with tools;
    tools already constrain output via their parameter schema.

**El turno final se emite sin `tools` y con `responseFormat: { type: 'json_schema' }`.**
llama.cpp convierte el schema a GBNF y restringe la generación a nivel de sampler, así que el
final schema deja de ser una validación *a posteriori* y pasa a ser una garantía estructural.
Zod sigue validando después (defensa en profundidad y para poder contar `F7`).

Consecuencia de diseño: el orchestrator tiene **dos fases** — fase de tools (con `tools`, sin
`responseFormat`) y fase final (sin `tools`, con `responseFormat`).

### 3. Determinismo disponible

`generationParams` expone `temp` y `seed`. Con `temp: 0` + `seed` fijo, el modo
`REDUNDANT_DETERMINISTIC` (doc 01 §23) es implementable de verdad, sin fingirlo.

### 4. `reasoning_budget: 0` para Qwen3

Qwen3 emite bloques `<think>`. `generationParams.reasoning_budget = 0` los desactiva por
request. Reduce latencia y evita que el razonamiento contamine el JSON final.

### 5. `type: 'function'` es obligatorio en cada tool

`validateTools` (`utils/tool-helpers.js`) hace `toolSchema.safeParse(tools[0])`.
Si falla, asume que el array es de `ToolInput` y llama `convertTools`, que espera
un **ZodObject** en `parameters`. Un objeto `{name, description, parameters: <JSON Schema>}`
no es ninguna de las dos cosas: pasa la deteccion como `ToolInput` y revienta al
convertir.

`toolSchema` exige el discriminante:

```ts
{ type: 'function', name, description, parameters: { type: 'object', properties, required? } }
```

Detectado al tipar los spikes contra el SDK real; el adapter mock no lo habria
revelado porque no pasa por `validateTools`. `ToolDefinition` en el adapter lo
incluye y `toolDefinitions()` lo emite.

El subconjunto de JSON Schema que acepta por propiedad es estrecho — solo
`type`, `description` y `enum` — asi que los schemas de las tools se escriben a
mano en `tool-schemas.ts` en vez de derivarlos de Zod con un conversor generico.

### 6. Mapeo de nombres para el adapter

| Contrato MeshCompute | Campo real del SDK |
|---|---|
| `content` | `final.contentText` |
| `stats.inputTokens` | `final.stats.promptTokens` |
| `stats.outputTokens` | `final.stats.generatedTokens` |

---

## Modelos locales de Ollama

Los modelos que la máquina ya tiene por Ollama se reutilizan en vez de
descargarse del registry de QVAC. Layout de Ollama:

    ~/.ollama/models/
      manifests/registry.ollama.ai/library/<nombre>/<tag>   <- JSON con capas
      blobs/sha256-<hex>                                     <- GGUF real

La capa `application/vnd.ollama.image.model` es el GGUF. Resuelto en
`packages/qvac-adapter/src/ollama-models.ts`.

Dos consecuencias:

1. **`modelType` explícito.** Los blobs se llaman `sha256-<hex>`, sin extensión,
   así que QVAC no puede inferir el engine del nombre. Se pasa
   `modelType: 'llamacpp-completion'`.

2. **El tool calling depende del chat template, no del tamaño del modelo.**
   Verificado leyendo `tokenizer.chat_template` de los metadatos GGUF:

   | Modelo | `general.architecture` | tools en template |
   |---|---|---|
   | `qwen3.5:4b` | `qwen35` | **sí** |
   | `qwen2.5vl:3b` | `qwen25vl` | **no** |

   `qwen2.5vl:3b` es multimodal y su template solo contempla
   `system`/`user`/`assistant`. Con él, el Reliability Orchestrator no recibe
   ninguna tool call y todo Track 2 se queda sin señal. Por eso
   `assertToolCapable()` falla al arrancar en vez de dejar que el benchmark
   salga a cero.

### RESUELTO: el backend Vulkan de la iGPU AMD cuelga (o mata) `loadModel`

**Síntoma.** `loadModel` no termina nunca con NINGÚN modelo (Llama 1B, Qwen
1.7B, Qwen3.5 4B). El worker Bare se queda con un core al 100% y la memoria
congelada (~350 MB), justo después de este log del addon nativo:

    ModelMetaData::parse: load the model metadata from disk file.

En algunos intentos el worker directamente muere
(`Bare worker exited mid-request, code=1`) — el crash de `QWEN3_1_7B_INST_Q4`
que antes se atribuía a un blob incompleto o a RAM era **esto mismo**.

**Diagnóstico.** No es la descarga (el GGUF estaba cacheado y validado por
checksum en `~/.qvac/models`), ni la arquitectura del GGUF, ni la RAM. El paso
siguiente al parse es la inicialización de backends de llama.cpp; el backend
Vulkan se cuelga dentro del driver de la iGPU AMD Radeon (Ryzen 5 4600H).
Pasa incluso pidiendo `device: 'cpu', gpu_layers: 0`: el registro del backend
Vulkan ocurre igual.

**Fix.** El prebuild `@qvac/embed-llamacpp` respeta la env var
`GGML_DISABLE_VULKAN`. Con `GGML_DISABLE_VULKAN=1` (puesta en el `.env` y
heredada por el worker al spawnearse):

| Modelo | Antes | Después |
|---|---|---|
| `demo-llm` (Llama 1B, registry) | timeout a los 300 s | carga 13.6 s, inferencia 1.6 s (CPU) |
| `tooluse-llm` (Qwen 1.7B, registry) | worker muere `code=1` | carga 10.5 s, inferencia 2.0 s (CPU) |

**Operativa.** La variable tiene que estar en `process.env` ANTES del primer
`loadModel` (el worker la hereda en el spawn). Los agentes la cargan vía
`loadEnv`; los spikes llaman `ensureEnvLoaded()` de `@meshcompute/config`.
En la máquina 2 (GPU dedicada), dejarla vacía y verificar con
`pnpm tsx spikes/load-local.ts demo-llm` antes de la demo: si también se
cuelga ahí, poner el flag y asumir CPU.

### `Failed to initialize model` con `local-tooluse-llm`: RAM libre insuficiente

Con ~4.8 GB de RAM libre, cargar `qwen3.5:4b` (3.4 GB Q4_K_M + KV + buffers)
falla rápido y limpio:

    common_fit_params: encountered an error while trying to fit params to
    free device memory: failed to load model

NO es la arquitectura: `qwen35` está en la lista de arquitecturas del engine
embebido (verificado en el binario win32-x64 de `@qvac/embed-llamacpp`). Es
memoria: el wrapper de QVAC ajusta los parámetros a la RAM libre y aborta si
el modelo no cabe. El warmup del provider lo reporta como
`model_warmup_failed ... Failed to initialize model`.

Salidas: liberar RAM (cerrar WSL/Docker/navegadores) o usar `tooluse-llm`
(Qwen3-1.7B, ~1 GB, con tools, verificado en esta máquina). Ventaja extra de
`tooluse-llm`: es descriptor del registry, portable entre máquinas, así que
cierra el riesgo abierto de rutas absolutas en inferencia delegada.

### Conectividad P2P: atajo LAN, relays y `PEER_CONNECTION_FAILED`

Verificado en `hyperdht@6.33.1` (el que embebe el SDK) y en
`delegate-connect-diagnostics.js`:

- `PEER_CONNECTION_FAILED` / `CANNOT_HOLEPUNCH` = el provider SÍ se encontró
  en la DHT; lo que falló es el holepunch NAT. `PEER_NOT_FOUND` es el caso
  contrario (no anunciado) y un relay no lo arreglaría.
- **Atajo LAN**: si ambos peers observan la misma IP pública, el consumer
  hace ping UDP directo a las IPs locales del provider, en paralelo al
  holepunch (`lib/connect.js`, opción `localConnection`, activa por defecto).
  La demo en la misma red NO depende del hairpin del router — pero sí de que
  el router no aísle a sus clientes entre sí.
- **Relays**: el SDK acepta `swarmRelays: string[]` (claves hex de blind
  relays) en `qvac.config.json` / `qvac.config.js` en la raíz del proyecto
  (también `QVAC_CONFIG_PATH`). No trae ningún relay por defecto; usarlo
  implica operar un relay propio en una IP pública.
- Diagnóstico por máquina: `pnpm nat:check` (spike nuevo; usa `hyperdht`
  directo, sin pasar por el SDK). Decision tree completo en
  `prueba-dos-maquinas.md` → "El consumer encuentra al provider pero no
  conecta".
- **Trampa verificada (2026-08-22)**: un rechazo del firewall QVAC se
  manifiesta en el consumer como `PEER_CONNECTION_FAILED`, indistinguible de
  un fallo de holepunch. Con allowlist no vacío + consumer sin
  `QVAC_HYPERSWARM_SEED` (identidad aleatoria por arranque), el rechazo es
  permanente. Vaciar el allowlist y reiniciar el provider lo resolvió.
- **Validado entre países (Ecuador ⇄ remoto)**: conexión fría DHT ~20.7 s,
  inferencia delegada 1.2 s (Llama 1B por CPU), `fallbackToLocal: false`.
  El holepunch NAT internacional funcionó sin relays una vez fuera el
  firewall.

### Riesgo abierto: rutas absolutas en inferencia delegada

En delegated inference el **consumer** llama a `loadModel({ modelSrc, delegate })`
y el **provider** es quien carga el modelo. Con un descriptor del registry eso da
igual: es un identificador portable. Con una ruta local de Ollama, `modelSrc` es
una ruta absoluta que solo existe tal cual en esta máquina.

Si el SDK envía la ruta literal al provider, la segunda máquina fallará salvo
que tenga el mismo modelo bajo la misma raíz. El nombre del blob sí es idéntico
entre máquinas (es su sha256); lo que cambia es la raíz del home.

**Sin verificar todavía.** Se comprueba en el spike de dos máquinas. Si falla,
las salidas son: fijar `OLLAMA_MODELS` a la misma ruta en ambas, o volver al
descriptor del registry para el camino delegado. No dar por hecho que funciona.

---

## Pendiente de validar con dos máquinas

- [ ] `delegate` + `modelConfig.tools` combinados (spike A1 + tools).
- [ ] `fallbackToLocal: false` con el provider apagado, debe fallar y no ejecutar local (T-05).
- [x] Latencia de conexión fría real DHT entre las dos máquinas: **~20.7 s**
      (Ecuador ⇄ remoto, 2026-08-22). Presupuestar ≥30 s en la demo antes de
      declarar fallo.
