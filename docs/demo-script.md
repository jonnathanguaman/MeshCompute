# MeshCompute — Guion de demo

> Adaptación del guion del doc 00 §42 al estado actual: portales con login,
> contratación, pago automático, saldos y reputación viva.

## Preparación (antes de la demo)

```bash
pnpm demo:reset          # base limpia + 2 providers y 3 jobs de seed
pnpm api:dev             # puerto 4000
pnpm consumer:start      # puerto 5050 (misma PC que el navegador)
pnpm web:dev             # puerto 3001
```

En la máquina proveedora (puede ser otra PC u otro país):

```bash
# camino simple (Llama 1B):
$env:PROVIDER_MODEL_KEY="demo-llm"; pnpm provider:start
# camino Track 2 (tool calling):
$env:PROVIDER_MODEL_KEY="tooluse-llm"; pnpm provider:start
```

Checklist previo (doc 00 §41 "Demo"):

- [ ] Modelo descargado y conexión P2P **precalentada** (una inferencia de prueba).
- [ ] `artifacts/benchmark-results.json` presente (dashboard con números reales).
- [ ] `PAYMENT_MODE` conocido (SIMULATED salvo que Sepolia esté configurada).
- [ ] 5 ejecuciones consecutivas probadas el mismo día.

## Recorrido (≈6 minutos)

1. **Portal del proveedor** — iniciar sesión en `http://localhost:3001/login`
   (rol Provider). Mostrar la oferta publicada: public key QVAC, descripción,
   precio y wallet. Mensaje: *"el proveedor no necesita estar en nuestra red ni
   mantener heartbeats para ofertar"*. Si hay dos máquinas, enseñar ambas.
2. **Portal del cliente** — sesión de cliente. Mostrar **saldo demo (100 mUSDT)**
   y contratar una máquina. Cambiar al portal del proveedor y **aceptar** el
   contrato.
3. **Privacidad** — abrir DevTools → Network, filtrar `4000`. Anunciar: *"el
   marketplace solo guarda metadatos; el prompt jamás pasa por aquí"*.
4. **Crear el job** — desde el contrato aceptado → "Run inference". El prompt se
   escribe en lenguaje natural (la instrucción JSON se antepone sola). Con el
   provider `tooluse-llm`, usar el prompt Track 2 del doc 00 §42.4.
5. **Ejecución** — señalar físicamente la máquina proveedora durante
   `CONNECTING → RUNNING`. En `/providers` el nodo aparece **BUSY** mientras
   computa. (Primera conexión: 15–45 s de bootstrap DHT.)
6. **Resultado + trace** — en el job: output local, panel de reliability con la
   cadena de tools (3/3, Schema PASSED, Grounding PASSED). Para el refusal,
   tener preparada una segunda ejecución con failure injection.
7. **Verificación y pago automático** — el timeline pasa solo de `VERIFIED` a
   `PAID` (etiqueta *SIMULATED PAYMENT* o *PAID ON TESTNET* según el modo).
   Nada que clickear: el settle es automático e idempotente.
8. **Saldos** — volver a los portales: el cliente gastó, el proveedor cobró
   (wallet strip). En DevTools verificar que solo viajaron hashes.
9. **Reputación** — en `/providers`, la reputación del nodo subió +1 y
   `jobs completed` incrementó. Ejecutar un fallo preparado (provider apagado)
   para mostrar el −5 si hay tiempo.
10. **Benchmark** — `/dashboard`: tabla baseline vs hardened con corridas
    reales y fallos por categoría (F1–F9). Cierre: *"no afirmamos fiabilidad,
    la medimos"*.

## Verificación redundante (opcional, si hay 2 providers con el mismo modelo)

En `/jobs/new`, elegir **Redundant deterministic** y el verifier en el
selector. El job termina `VERIFIED` con dos hashes visibles en "Safe metadata".

## Qué decir / qué no decir

Usar los textos del doc 00 §43 y respetar §44 (no prometer confidential
computing, ZK ni USDT real).

## Fallos ensayados

| Situación | Qué se muestra |
|---|---|
| Consumer Agent apagado | "Local Consumer Agent is not running. Start it with pnpm consumer:start." |
| Provider apagado | Job `FAILED` + reputación −5; nunca ejecución local silenciosa |
| Tool sin evidencia | `REFUSED — required evidence was unavailable` (no es un crash) |
| Pago fallido | `PAYMENT_FAILED` + botón "Retry automatic payment" |
