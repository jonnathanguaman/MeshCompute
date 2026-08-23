# Prueba en dos máquinas — guía paso a paso

> Objetivo: demostrar que **una máquina pide una inferencia y otra máquina
> físicamente distinta la ejecuta** por QVAC P2P (doc 01, criterio A1).
>
> Nomenclatura: **PC1 = Provider** (ejecuta el modelo), **PC2 = Consumer**
> (pide la inferencia y corre la web).

Cada paso tiene un **criterio de éxito** explícito. Si un paso no lo cumple, no
sigas al siguiente: los fallos se acumulan y luego cuesta saber cuál fue.

---

## Antes de empezar

| Requisito | Comprobación |
|---|---|
| Node >= 22.17 en ambas | `node -v` |
| pnpm en ambas | `pnpm -v` (si falta: `npm i -g pnpm`) |
| Repo clonado en ambas | mismo commit en las dos |
| Conexión a internet | QVAC usa una DHT pública para el descubrimiento |

**Sobre la red**: no hace falta que estén en la misma LAN ni abrir puertos —
hyperswarm hace hole-punching. Sí conviene evitar redes corporativas con
firewall agresivo. Si el venue tiene WiFi restringido, ten a mano un hotspot
móvil (doc 00 §33, H21–H24).

---

## Paso 0 · Preparar las dos máquinas

Ejecuta esto **en PC1 y en PC2**:

```bash
pnpm install
cp .env.example .env
pnpm qvac:doctor
```

> **El primer `qvac:doctor` suele fallar** con
> `RPC initialization timed out after 30000ms`. No es un fallo real: el runtime
> Bare extrae sus binarios nativos la primera vez. **Vuelve a ejecutarlo.**

**Criterio de éxito**: `=== resultado: OK ===` y un `artifacts/qvac-doctor.json`
generado. Guarda ese archivo de las dos máquinas: el hardware va al README para
la submission (doc 01 §40).

---

## Paso 1 · Elegir un modelo que cargue de verdad

Este paso existe porque **no todos los GGUF cargan** con el llama.cpp que trae
QVAC 0.17.1. Averiguarlo aquí cuesta 2 minutos; averiguarlo durante la demo
cuesta la demo.

```bash
pnpm models:check
```

Salida esperada:

```
demo-llm             tools:NO  registry  Llama-3.2-1B-Instruct-Q4_0
tooluse-llm          tools:SI  registry  Qwen3-1.7B-Instruct-Q4
local-tooluse-llm    tools:SI  ollama    Qwen3.5-4B          3.39 GB  blob OK
local-vision-llm     tools:NO  ollama    Qwen2.5-VL-3B       3.20 GB  blob OK
```

Ahora valida que el modelo que quieras usar **carga y genera**, en PC1:

```bash
pnpm tsx spikes/load-local.ts <modelKey>
```

**Criterio de éxito**: imprime `loaded in <n> ms` y luego una respuesta.

**Cómo leer un fallo.** Para saber en qué punto está, activa los logs del SDK:

```bash
pnpm tsx spikes/debug-load.ts
```

Ese spike imprime el log del worker, que dice literalmente en qué fase va:

```
✅ Using cached model: …\.qvac\models\…gguf
parse: load the model metadata from disk file.   <- fase de metadatos
```

| Síntoma | Qué significa |
|---|---|
| `loaded in …` + respuesta | El modelo sirve. |
| Se queda en `parse: load the model metadata` | El parser de metadatos GGUF va lentísimo. **No lo mates**: puede tardar mucho más de lo razonable. Ver abajo. |
| `Bare worker exited mid-request (code=1)` | Crash real del engine. Otro modelo. |
| `Bare worker exited (code=null, signal=null)` | **Lo mataste tú** (o un `timeout`). No es un fallo del modelo. |

> **No midas por la RAM libre del sistema.** Baja aunque el modelo no se esté
> cargando, porque Windows cachea el fichero en disco. Y tampoco sirve el
> working set del proceso: `llama.cpp` usa `mmap`, así que los pesos **no**
> aparecen ahí. El único indicador fiable es el log del worker.

> **Paciencia antes de matar.** Un `loadModel` que lleva minutos puede estar
> progresando. Mata el proceso solo cuando el log lleve mucho tiempo sin cambiar
> de fase, y anota **en qué fase** se quedó: es el dato que permite diagnosticar.

> **Estado conocido en el equipo de pruebas** (Ryzen 5 4600H, sin GPU, 20 GB):
> `QWEN3_1_7B_INST_Q4` crashea el worker y `qwen3.5:4b` (arch `qwen35`) no llega
> a cargar. Ver `docs/qvac-findings.md`. Valida el tuyo antes de la demo.

### Si vas a usar un modelo de Ollama

El modelo tiene que estar **en PC1**, que es quien lo ejecuta:

```bash
ollama pull <modelo>     # en PC1
```

⚠️ **Riesgo abierto**: con modelos de Ollama, `modelSrc` es una ruta absoluta
(`C:\Users\<tu-usuario>\.ollama\models\blobs\sha256-…`). El consumer la envía y
el **provider** la resuelve. Si los nombres de usuario difieren entre PC1 y PC2,
puede fallar. El nombre del blob sí es idéntico (es su sha256); lo que cambia es
la raíz.

Salidas si eso ocurre:
1. Fija `OLLAMA_MODELS` a la misma ruta absoluta en ambas máquinas, o
2. usa un `modelKey` del registry de QVAC (`demo-llm`), que es portable.

Este punto **no está verificado todavía**. El Paso 3 es exactamente donde se
sabrá.

---

## Paso 2 · PC1: levantar el Provider

### 2a · Spike aislado primero

Antes de los agentes, el camino mínimo:

```bash
pnpm spike:provider --warmup
```

Salida esperada:

```
  QVAC provider started
  Public key: d03c6283d7b28572703850970a7c1aa04709c77129362d05fb417a0fd2c880bf

  Copy that key to machine 2 and run:
    pnpm spike:consumer --key d03c6283…
```

**Criterio de éxito**: aparece una public key de **64 caracteres hex**.

**Copia esa clave.** La necesitas en PC2. Es pública por diseño: el consumer la
usa para conectarse. Puedes mandarla por chat sin problema.

> Para que la clave **no cambie** entre reinicios, pon `QVAC_HYPERSWARM_SEED` en
> el `.env` de PC1. Sin eso tendrás que recopiarla cada vez.

Deja este proceso corriendo.

---

## Paso 3 · PC2: el spike consumer (el momento de la verdad)

En PC2, con la clave de PC1:

```bash
pnpm spike:consumer --key <publicKey-de-PC1>
```

La primera conexión **tarda 15–45 s**: hay que arrancar la DHT en frío. Es
normal y solo pasa la primera vez.

**Criterio de éxito**:

```
connected in 23120 ms (modelId=…)
{"answer": 159654}

=== result ===
  content        : {"answer": 159654}
  promptTokens   : 42
  generatedTokens: 12
  connect        : 23120 ms
  inference      : 1840 ms
```

**Esto es el criterio A1 del doc 01 §4.** Si funciona, tienes cómputo remoto
real. Si no funciona, **para aquí**: el doc lo marca como bloqueo crítico para
todo el equipo.

### Comprobación de honestidad (T-05)

Muy importante, y se hace ahora:

1. **Corta el provider en PC1** (Ctrl+C).
2. Repite `pnpm spike:consumer --key <misma-clave>` en PC2.

**Criterio de éxito**: **debe fallar** con `PROVIDER_UNREACHABLE`.

Si devolviera una respuesta, significaría que se ejecutó en local y toda la
demostración sería falsa. Por eso `fallbackToLocal` está en `false`.

Vuelve a arrancar el provider antes de seguir.

---

## Paso 4 · Los agentes completos

Ahora lo mismo pero con los agentes reales, que es lo que verá el jurado.

### PC1 — Provider Agent

Edita el `.env` de PC1:

```env
MARKETPLACE_DISABLED=true
PROVIDER_WALLET=0x0000000000000000000000000000000000000001
PROVIDER_NAME=Gaming-PC-01
PROVIDER_HARDWARE=RTX-4070
PROVIDER_MODEL_KEY=<el modelKey que validaste en el Paso 1>
PROVIDER_WARMUP_MODEL=true
```

```bash
pnpm provider:start
```

**Criterio de éxito**:

```
event=provider_started firewall=open
  Public key: …
event=model_warmup_done  modelKey=… durationMs=…
event=marketplace_registered providerId=…
  Waiting for delegated inference jobs.
```

Espera a ver `model_warmup_done` antes de seguir. Ese paso es el que evita que
la primera inferencia de la demo se quede descargando pesos.

### PC2 — Consumer Agent

En el `.env` de PC2:

```env
MARKETPLACE_DISABLED=true
QVAC_FALLBACK_TO_LOCAL=false
CONSUMER_MODEL_KEY=<el mismo modelKey>
WEB_ORIGIN=http://localhost:3000
```

```bash
pnpm consumer:start
```

**Criterio de éxito**:

```
  Consumer Agent listening on http://127.0.0.1:5050
  fallbackToLocal    : false
  reliability        : enabled
```

Y en otra terminal de PC2:

```bash
curl http://127.0.0.1:5050/health
```

→ `{"status":"ok","service":"consumer-agent","qvacReady":false}`

`qvacReady: false` al arrancar es correcto: aún no hay sesión QVAC abierta.
Pasa a `true` tras la primera inferencia.

### La inferencia completa

Edita `docs/examples/inference-request.json` y pon la **public key de PC1** en
`provider.qvacPublicKey`. Luego, desde PC2:

```bash
curl -X POST http://127.0.0.1:5050/v1/inference \
  -H 'Content-Type: application/json' \
  -d @docs/examples/inference-request.json
```

**Criterio de éxito**: un JSON con `content`, `outputHash` de 64 hex,
`stats`, `verification.status` y `reliability.trace`.

Si el modelo soporta tools, el `trace` debe traer las tres:

```json
"trace": [
  {"turn":1,"toolName":"get_provider_status","executionStatus":"SUCCESS"},
  {"turn":2,"toolName":"get_job_metadata","executionStatus":"SUCCESS"},
  {"turn":3,"toolName":"calculate_expected_cost","executionStatus":"SUCCESS"}
]
```

---

## Paso 5 · Pruebas de aceptación

Con todo levantado, verifica lo que el doc 00 §35 exige.

### T-04 · Inferencia remota real

Ya cubierto en el Paso 3. **Señala físicamente PC1** durante la demo: es el
gesto que hace entendible el producto.

### T-05 · Sin fallback local

Ya cubierto. Repítelo con los agentes: apaga PC1, lanza el `curl` desde PC2,
y comprueba que responde `502 PROVIDER_UNREACHABLE`.

### T-09 · Privacidad en la red

Este es el que respalda la afirmación central ante el jurado. Con la API
central levantada (`MARKETPLACE_DISABLED=false`), en PC2:

```bash
# Captura el tráfico hacia el puerto 4000 mientras lanzas una inferencia
```

O más simple, sin herramientas extra: los logs del Consumer Agent muestran
exactamente lo que se envía. **El prompt no debe aparecer en ninguna petición
al puerto 4000.**

Comprobación equivalente automatizada:

```bash
pnpm test tests/privacy.test.ts
```

### 5 ejecuciones consecutivas (DoD A)

```bash
for i in 1 2 3 4 5; do
  curl -s -X POST http://127.0.0.1:5050/v1/inference \
    -H 'Content-Type: application/json' \
    -d @docs/examples/inference-request.json | head -c 120
  echo
done
```

**Criterio de éxito**: las cinco responden. La primera es lenta (conexión fría);
de la segunda en adelante deben ser notablemente más rápidas, porque se reutiliza
el socket abierto.

### Benchmark Track 2

Solo si el modelo soporta tool calling:

```bash
pnpm benchmark --adapter real --key <publicKey-de-PC1> --model <modelKey>
```

Genera `artifacts/benchmark-results.json` y `artifacts/benchmark-failures.json`.
**No edites esos JSON a mano.** Los números del README salen de ahí.

---

## Troubleshooting

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `RPC initialization timed out after 30000ms` | Primer arranque del worker Bare | Reejecutar. Solo pasa la primera vez por máquina. |
| Worker vivo, RAM plana, un core al 100%, nunca carga | Backend Vulkan colgado en la iGPU AMD | `GGML_DISABLE_VULKAN=1` en el `.env`. Ver `qvac-findings.md`. |
| `Bare worker exited mid-request` | Mismo cuelgue de Vulkan (a veces mata el worker en vez de colgarlo) | `GGML_DISABLE_VULKAN=1` en el `.env`. |
| `PEER_CONNECTION_FAILED` / `CANNOT_HOLEPUNCH` con el provider encontrado en la DHT | **1º sospechoso: el firewall QVAC.** Si `QVAC_FIREWALL_ALLOWED_KEYS` tiene claves y el consumer no fija `QVAC_HYPERSWARM_SEED`, su identidad cambia en cada arranque y el provider lo rechaza SIEMPRE — se ve idéntico a un fallo de NAT. | Vaciar `QVAC_FIREWALL_ALLOWED_KEYS` y reiniciar el provider. Si persiste, es NAT de verdad: sección abajo. |
| `PROVIDER_UNREACHABLE` con el provider encendido | Clave mal copiada, o provider reiniciado | Verifica los 64 hex. Si reiniciaste PC1, **reinicia también el consumer**: el SDK no reconecta solo. |
| `providerPublicKey must be a 64-character hex string` | Clave truncada al copiar | Cópiala entera. |
| Primera conexión eterna (>60 s) | DHT en frío o red restrictiva | Espera. Si persiste, prueba con hotspot móvil. |
| `cannot do tool calling` al arrancar | El modelo no declara tools en su template | Usa uno con `tools:SI` en `pnpm models:check`. |
| La UI no puede llamar al agente | CORS | `WEB_ORIGIN` debe ser el origen exacto de la web. |
| `CONSUMER_AGENT_BUSY` | Ya hay una inferencia en curso | Es correcto: el agente atiende una a la vez. |

### El consumer encuentra al provider pero no conecta

Síntoma exacto:

    Provider encontrado en la DHT
    NAT/holepunch failure: PEER_CONNECTION_FAILED
    no swarm relays configured

El anuncio en la DHT funciona; lo que falla es abrir el camino UDP entre las
dos máquinas. Diagnóstico sin adivinar — **en cada máquina**:

```bash
pnpm nat:check
```

Imprime la IP pública que la DHT observa, el puerto, si está `firewalled` y
las IPs locales. Interpretación:

**Caso A — misma IP pública en ambas (misma red).** HyperDHT tiene un atajo
LAN: cuando los dos peers ven la misma IP pública, el consumer hace ping
directo a la IP local del provider. Si aun así falla, el router está
bloqueando el tráfico entre sus propios clientes (*AP/client isolation*,
común en routers de ISP). Verifícalo con un `ping <ip-local-de-la-otra>`
normal: si no responde, es el router.
Fixes, en orden: desactivar el aislamiento en el router → hotspot del
teléfono con ambas máquinas conectadas → cable Ethernet entre ambas.

**Caso B — IPs públicas distintas y `firewalled: SÍ` en ambas.** Al menos un
lado está tras CGNAT del ISP (típico en redes residenciales y móviles) y el
holepunch doble-NAT no es viable. Para la demo, la salida realista es poner
las dos máquinas en la misma red (Caso A). La alternativa "de verdad" es un
blind relay: el SDK acepta `swarmRelays` (claves públicas hex de relays) en
un `qvac.config.json` en la raíz del proyecto, pero requiere operar un relay
en una máquina con IP pública — fuera del alcance del hackathon.

Prueba fina opcional: `pnpm nat:check --ping <host:puerto>` desde una máquina,
usando el `host:puerto` que imprimió la otra. Si el ping DHT responde, hay
camino UDP directo y el holepunch debería funcionar.

Nota: el firewall de Windows ya quedó verificado en PC1 (reglas inbound
TCP/UDP para `bare.exe`, perfil Public). Si PC2 nunca mostró el prompt del
firewall, revisar ahí lo mismo:
`Get-NetFirewallApplicationFilter | Where-Object { $_.Program -match 'bare' }`.

### Comandos de limpieza

Si algo queda colgado:

```bash
# Windows — matar workers QVAC huérfanos
taskkill /F /IM bare.exe
```

Los workers huérfanos compiten por CPU y RAM, y hacen que todo lo demás parezca
lento. Si has lanzado varias pruebas seguidas, limpia antes de medir nada.

---

## Checklist antes de la demo

Doc 01 §36 y doc 00 §41.

- [ ] `pnpm qvac:doctor` OK en las dos máquinas
- [ ] Modelo validado con `spikes/load-local.ts` (carga **y** genera)
- [ ] Provider arranca y muestra su public key
- [ ] `model_warmup_done` visible (modelo ya en memoria)
- [ ] Spike consumer PC2 → PC1 devuelve resultado real
- [ ] T-05: con el provider apagado, **falla**
- [ ] `/health` responde en PC2
- [ ] `/v1/inference` devuelve `outputHash` de 64 hex
- [ ] Trace con las 3 tools (si el modelo las soporta)
- [ ] 5 ejecuciones consecutivas OK
- [ ] Conexión **caliente**: no reinicies el provider después de esto
- [ ] Public key anotada por si hay que reconectar
- [ ] Hardware y modelo de ambas máquinas anotados para el README

### Lo que hay que tener a mano durante la demo

- La public key de PC1 en un sitio copiable.
- Las dos máquinas ya calientes (una inferencia hecha).
- Un hotspot móvil por si la red del venue falla.
- `docs/handoff-A.md` con los códigos de error, por si algo se rompe en vivo y
  hay que explicar qué se está viendo.
