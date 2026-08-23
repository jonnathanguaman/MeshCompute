# MeshCompute — Integrante C
## Frontend, flujo de usuario, Tool Trace, benchmark y experiencia de demo

> Tu responsabilidad es que el jurado entienda en segundos qué está pasando.
>
> No implementas QVAC ni pagos. Construyes la capa que une visualmente el Marketplace API y el Consumer Agent local.

---

# 1. Ownership

Solo tú modificas normalmente:

```text
apps/web/**
```

No modificar:

```text
apps/provider-agent/**
apps/consumer-agent/**
apps/marketplace-api/**
```

Consumir:

```text
packages/contracts/**
```

---

# 2. Objetivo final

La web debe permitir:

```text
ver providers
   ↓
seleccionar uno
   ↓
escribir prompt
   ↓
crear job metadata
   ↓
enviar prompt a localhost
   ↓
ver inferencia remota
   ↓
ver resultado
   ↓
verificación
   ↓
settlement
```

---

# 3. Regla de privacidad

Nunca enviar el prompt a:

```text
MARKETPLACE_API_URL
```

El prompt solo puede ir a:

```text
CONSUMER_AGENT_URL
```

Antes del envío central:

```text
promptHash = SHA-256(prompt)
```

Central recibe hash.

---

# 4. Arquitectura cliente

```text
                       Web
                ┌───────┴────────┐
                │                │
                ▼                ▼
       Marketplace API      Consumer Agent
          port 4000          localhost 5050
                │                │
             metadata          prompt
                │                │
                │                ▼
                │             QVAC P2P
                │                │
                └────────┐       ▼
                         │     Provider
                         │
                         ▼
                    Job status
```

---

# 5. No debes esperar por los demás

Desde H1 trabajar con:

```env
NEXT_PUBLIC_USE_MOCKS=true
```

Mocks de reliability deben estar marcados con `mock: true` y desaparecer del build/demo final cuando haya resultados reales.

Mocks deben usar tipos reales de:

```text
packages/contracts
```

No inventes otra estructura.

---

# 6. Estructura sugerida

```text
apps/web/
  src/
    app/
      page.tsx
      providers/
        page.tsx
      jobs/
        new/
          page.tsx
        [id]/
          page.tsx
      dashboard/
        page.tsx

    components/
      ProviderCard.tsx
      JobTimeline.tsx
      PaymentBadge.tsx
      ReputationBadge.tsx
      PrivacyNotice.tsx
      AgentStatus.tsx
      StatCard.tsx
      ToolTrace.tsx
      ReliabilityBadge.tsx
      BenchmarkCard.tsx
      FailureBadge.tsx

    lib/
      marketplace-api.ts
      consumer-agent.ts
      hashing.ts
      format-money.ts

    hooks/
      useProviders.ts
      useJob.ts
      useConsumerAgent.ts

    mocks/
      demo-data.ts
```

---

# 7. Pantalla `/providers`

Debe mostrar cards.

Campos:

```text
name
hardware
model
online
reputation
price
```

Ejemplo:

```text
Gaming-PC-01                         ONLINE

RTX 4070
Llama 3.2 1B Q4

Reputation: 97/100
Price: 0.002 mUSDT / 1K tokens

[ Run inference ]
```

---

# 8. Estados de provider

```text
ONLINE
OFFLINE
BUSY
```

Para demo:

- ONLINE destacado;
- OFFLINE deshabilita botón.

No necesitas animaciones complejas.

---

# 9. New Job

Ruta:

```text
/jobs/new?provider=p_001
```

Mostrar:

- provider;
- hardware;
- model;
- reputación;
- textarea;
- verification mode;
- privacy note;
- estimated price;
- Run button.

---

# 10. PrivacyNotice

Texto claro:

```text
Your prompt and AI response are not stored by the MeshCompute marketplace.
The prompt is sent from your local Consumer Agent directly to the selected
compute provider over the QVAC P2P layer.
```

También:

```text
The selected provider processes the workload and may access its contents.
```

No prometer confidential computing.

---

# 11. Antes de Run

Comprobar Consumer Agent:

```http
GET http://127.0.0.1:5050/health
```

Si no responde:

```text
Consumer Agent not running

Start:
pnpm consumer:start
```

No crear job si el usuario no puede ejecutar.

---

# 12. Hash del prompt

En browser:

```ts
crypto.subtle.digest('SHA-256', ...)
```

Resultado:

```text
64 hex chars
```

No usar backend para calcularlo.

---

# 13. Flujo exacto Run

```text
Click Run
   │
   ▼
health local agent
   │
   ▼
hash prompt locally
   │
   ▼
POST central /jobs
(no prompt)
   │
   ▼
jobId + executionToken
   │
   ▼
navigate /jobs/:id
   │
   ▼
POST localhost /v1/inference
(prompt)
   │
   ▼
poll central job
   │
   ▼
receive local raw result
   │
   ▼
show output
```

---

# 14. Cliente central

Archivo:

```text
lib/marketplace-api.ts
```

Funciones:

```ts
getProviders()
getProvider(id)
createJob(input)
getJob(id)
getJobs()
settleJob(id)
getStats()
```

No permitir que `createJob()` acepte un campo prompt en TypeScript.

---

# 15. Cliente Consumer Agent

Archivo:

```text
lib/consumer-agent.ts
```

Funciones:

```ts
health()
runInference(input)
```

Esta función sí recibe prompt.

Es la única capa de red que debe recibirlo.

---

# 16. Separación visual y de código

Muy importante:

```text
marketplace-api.ts
```

NO debe importar tipos que contienen prompt.

```text
consumer-agent.ts
```

sí.

Esto evita filtración accidental.

---

# 17. Job Detail

Ruta:

```text
/jobs/[id]
```

Componentes:

```text
Provider summary
JobTimeline
Inference result
Verification
Payment
Hashes/metrics
```

---

# 17A. Reliability panel en `/jobs/[id]`

Además del estado normal del job, mostrar un panel separado:

```text
RELIABILITY

Tool calls              3/3
Schema validation       PASSED
Grounding               PASSED
Retries                  0
Final status             PASSED
```

Y trace:

```text
1  get_provider_status       success   18 ms
2  get_job_metadata          success   13 ms
3  calculate_expected_cost  success    2 ms
```

Si falla:

```text
2  get_job_metadata          error      retry 1
2  get_job_metadata          error      TIMEOUT
Final status                         REFUSED
```

Nunca inventar `PASSED` para que el demo se vea bonito.

El trace llega desde `Consumer Agent` y permanece en estado local de la UI; no se reenvía al Marketplace API.

---

# 18. Timeline

Mapear estados:

```text
CREATED → Created
ASSIGNED → Provider selected
CONNECTING → Connecting P2P
RUNNING → Running on provider
VERIFYING → Verifying
VERIFIED → Verified
PAYMENT_PENDING → Settling
PAID → Paid
PAYMENT_FAILED → Payment failed
FAILED → Failed
```

---

# 19. Polling

Para evitar WebSocket:

```text
GET /jobs/:id
```

cada:

```text
1000 ms
```

Detener cuando:

```text
PAID
PAYMENT_FAILED
FAILED
VERIFICATION_FAILED
```

---

# 20. Resultado

El raw output existe en estado local de la UI.

No llamar a:

```text
PATCH central
```

con ese contenido.

Mostrarlo:

```text
AI Output

{
  "answer": 159654
}
```

---

# 21. Si refrescan la página

El raw output se perderá.

Eso es aceptable para el MVP y coherente con no almacenarlo centralmente.

Mostrar:

```text
The AI response is not stored by MeshCompute.
Run the inference again to regenerate it.
```

Esto incluso refuerza la privacidad.

---

# 22. Verification UI

Mostrar:

```text
Verification
✓ PASSED

Mode:
Local deterministic validation
```

o:

```text
Redundant provider verification
```

No mostrar "ZK Proof".

---

# 23. Payment UI

Estados:

```text
NOT_STARTED
PENDING
PAID
FAILED
SIMULATED
```

Si `SIMULATED`:

```text
SIMULATED PAYMENT
Demo settlement — no real funds used.
```

Si testnet:

```text
PAID ON TESTNET
Tx: 0x...
```

---

# 24. Dashboard

Ruta:

```text
/dashboard
```

Cards:

```text
Online Providers
Completed Jobs
Verified Jobs
Success Rate
Total Demo Paid
```

No dediques más de 1–2 horas a charts.

Cards son suficientes.

---

# 24A. BenchmarkCard

Mostrar solo cuando exista resultado real:

```text
Small-model reliability
Model: Qwen3 1.7B Q4
Runs: 30

Metric                 Baseline   Hardened
Task success             ...        ...
Valid tool args          ...        ...
Grounded answers         ...        ...
Correct refusal          ...        ...
Hallucinated results     ...        ...
```

Los valores vienen de `benchmark-results.json` o de una respuesta local generada desde ese archivo.

Mientras A no haya corrido el benchmark:

```text
Benchmark: NOT RUN
```

No usar porcentajes mock en el build final.

Mostrar además failures reales:

```text
WRONG_TOOL             n
INVALID_ARGS           n
IGNORED_TOOL_RESULT    n
TOOL_TIMEOUT           n
GROUNDING_MISMATCH     n
```

El objetivo visual es que el jurado vea **evidencia, no solo una ejecución bonita**.

---

# 25. Landing

Ruta `/`.

Título:

```text
MeshCompute
Decentralized AI Compute Marketplace
```

Subtítulo:

```text
Turn idle compute into peer-to-peer AI inference.
```

CTA:

```text
Explore Providers
```

Visual simple de flujo:

```text
Consumer → QVAC P2P → Provider → Verified → Paid
```

---

# 26. Mock data

`mocks/demo-data.ts`

Debe incluir:

- 2 online providers;
- 1 offline;
- job running;
- job verified;
- job paid.

Usar exactamente DTOs compartidos.

---

# 27. Mock switch

```env
NEXT_PUBLIC_USE_MOCKS=true
```

`marketplace-api.ts`:

```ts
if (USE_MOCKS) return mockProviders;
```

Cuando B esté listo:

```env
false
```

Sin reescribir componentes.

---

# 28. Mock Consumer Agent

Antes de A:

```ts
if (USE_MOCKS) {
  await sleep(1500)
  return {
    content: '{"answer":159654}',
    ...
  }
}
```

Así terminas Job Detail sin esperar.

---

# 29. Error UX

## API central down

```text
Marketplace unavailable.
```

## Consumer Agent down

```text
Local Consumer Agent is not running.
```

## Provider offline

```text
Provider is no longer available.
Choose another provider.
```

## QVAC timeout

```text
Remote inference timed out.
```

## Verification failed

```text
Result could not be verified.
No payment was settled.
```

## Payment failed

```text
Inference succeeded, but settlement failed.
```

---

## Tool invalid args

Mostrar:

```text
Tool arguments rejected. Retrying safely…
```

si el retry está activo.

## Insufficient evidence

Mostrar como estado legítimo, no como crash:

```text
REFUSED — required evidence was unavailable.
```

## Grounding mismatch

Mostrar:

```text
Verification failed: model answer did not match tool evidence.
```

No enseñar stack traces al jurado.

---

# 30. Estado local durante inferencia

Mantener:

```ts
type LocalInferenceState = {
  rawOutput?: string;
  localError?: string;
  isCallingAgent: boolean;
}
```

No persistir en localStorage a menos que sea necesario.

Por privacidad:

```text
memory only
```

preferible.

---

# 31. Precio

Backend devuelve atomic string.

Helper:

```text
formatTokenAtomic("2000", 6)
→ "0.002"
```

No uses floats para transferencias.

Para mostrar sí puedes formatear decimal.

---

# 32. Integración con B

Necesitas primero:

```text
GET /providers
POST /jobs
GET /jobs/:id
POST /jobs/:id/settle
GET /stats
```

Hasta que estén:

mocks.

---

# 33. Integración con A

Necesitas:

```text
GET localhost:5050/health
POST localhost:5050/v1/inference
```

Hasta que esté:

mock local client.

---

# 34. Tu trabajo tampoco es lineal

Mantén cuatro superficies en paralelo usando fixtures:

```text
MARKETPLACE UI     JOB UI       RELIABILITY UI      DEMO/PITCH UI
providers          new job      ToolTrace           privacy notice
status             timeline     ReliabilityBadge    status/errors
pricing            result       BenchmarkCard       payment proof
```

No esperes a A para dibujar trace ni a B para construir providers: usa tipos compartidos y flags de mock.

---

# 35. Cronograma personal paralelo

## H0–H1

- Next/Tailwind;
- leer contracts;
- crear fixtures provider/job/reliability.

## H1–H3

- `/providers`;
- `/jobs/new`;
- `/jobs/[id]`;
- `ToolTrace` mock.

## H3–H6

- conectar providers a B cuando esté disponible;
- mantener job/inference mock por flags;
- ReliabilityBadge + privacy UX.

## H6–H9

- `Run inference` a localhost A;
- timeline;
- trace real si existe;
- errores Agent/API separados.

## H9–H12

- payment UI;
- refusal UX;
- grounding mismatch UX;
- BenchmarkCard con `NOT RUN` hasta tener resultados.

## H12–H16

- cargar benchmark real de A;
- baseline vs hardened;
- failure counts;
- dashboard y polish.

## H16–H18

- probar provider offline;
- Consumer Agent down;
- tool timeout;
- payment failure;
- revisar Network tab y privacidad.

## H18+

- cero features nuevas;
- eliminar datos mock visibles;
- ensayar demo;
- preparar grabación.

---

# 36. Checkpoint H3

Debes poder mostrar todo el flujo con mocks:

```text
providers
↓
new job
↓
running
↓
verified
↓
paid
```

---

# 37. Checkpoint H6

Provider real de A aparece usando API real de B.

---

# 38. Checkpoint H9

Botón Run utiliza Consumer Agent real.

Resultado real en UI.

---

# 39. Checkpoint H12

Timeline refleja estados reales.

Payment simulated funciona.

---

# 40. Demo mode

Puedes tener:

```env
NEXT_PUBLIC_DEMO_MODE=true
```

Solo para:

- mensajes más claros;
- polling más frecuente;
- esconder features incompletas.

No debe fingir QVAC.

---

# 41. Qué debe verse físicamente

Cuando `RUNNING`:

```text
Running on Gaming-PC-01
RTX 4070
via QVAC P2P
```

Esto ayuda al jurado a asociar la tarea con la otra computadora.

---

# 42. UX de privacidad recomendada

Pequeño panel:

```text
Privacy
✓ Prompt is not stored by MeshCompute
✓ Response is not stored by MeshCompute
✓ Direct QVAC P2P workload transport
! Compute provider processes the workload
```

Es una fortaleza del pitch.

---

# 43. No crear login

No perder tiempo con:

- Auth0;
- Clerk;
- OAuth;
- perfiles.

Para demo:

```text
anonymous consumer
```

es suficiente.

---

# 44. No crear UI innecesaria

No hacer:

- settings;
- notifications;
- billing pages;
- admin panel;
- provider management GUI;
- token purchase screen.

---

# 45. Pruebas tuyas

## UI-01

Providers mock render.

## UI-02

Providers real render.

## UI-03

Offline button disabled.

## UI-04

Central createJob body no contiene prompt.

## UI-05

Consumer request sí contiene prompt y apunta a localhost.

## UI-06

Agent down error.

## UI-07

Job polling stops.

## UI-08

SIMULATED label visible.

## UI-09

Refresh loses output but keeps metadata.

## UI-10

Privacy copy correct.

---

## UI-11

Trace muestra tools en orden correcto.

## UI-12

`REFUSED` se distingue visualmente de `FAILED`.

## UI-13

Grounding failure nunca aparece como VERIFIED.

## UI-14

Benchmark mock no aparece en modo demo final.

## UI-15

Baseline/Hardened muestran mismo N/dataset metadata cuando la comparación es válida.

---

# 46. Network test de privacidad

Abrir DevTools.

Ejecutar job.

Filtrar:

```text
localhost:4000
```

Inspeccionar requests.

No debe existir el texto del prompt.

Después filtrar:

```text
127.0.0.1:5050
```

Ahí sí existe.

Este test puede incluso enseñarse al jurado si preguntan.

---

# 47. Definition of Done C

- [ ] landing.
- [ ] providers.
- [ ] provider real visible.
- [ ] new job.
- [ ] hash local.
- [ ] central create without prompt.
- [ ] Consumer Agent health.
- [ ] local inference call.
- [ ] output in UI.
- [ ] timeline.
- [ ] polling.
- [ ] verification state.
- [ ] payment state.
- [ ] tx hash.
- [ ] simulated label.
- [ ] privacy notice.
- [ ] error states.
- [ ] dashboard.
- [ ] no prompt central.
- [ ] demo responsive.

---

# 48. Fallbacks

## API unavailable

Usar mocks solo para enseñar UI, pero no como demo principal.

## Consumer Agent unavailable

Mostrar instrucción de arranque.

## Payment fails

Mostrar:

```text
PAYMENT_FAILED
```

y no ocultar el fallo.

## Dashboard incomplete

Eliminarlo.

No afecta core demo.

---

# 49. Lo que no debes tocar

No intentes resolver:

- QVAC SDK;
- provider process;
- SQLite;
- WDK internals;
- blockchain;
- smart contract;
- WebSocket;
- model selection logic.

Tu trabajo es consumir contratos.

---

# 50. Handoff final

Entregar:

- URL web;
- rutas;
- env;
- qué requests van a central;
- qué request va a localhost;
- guion visual;
- screenshots de fallback;
- instrucciones para reset demo.

Antes del pitch, confirmar junto a A y B:

```text
provider online
consumer agent online
API online
model downloaded
payment mode known
```


---

# 51. Orden visual recomendado para el jurado

En `/jobs/[id]`:

```text
1. Provider + QVAC P2P
2. Job timeline
3. Result
4. Agent Tool Trace
5. Schema / Grounding / Refusal
6. Verification
7. Payment
```

En `/dashboard`:

```text
1. providers online
2. jobs/success
3. baseline vs hardened reliability
4. real failure counts
5. payments
```

La UI debe dejar claro que Track 2 es una propiedad de la **misma ejecución de MeshCompute**, no una demo paralela desconectada.
