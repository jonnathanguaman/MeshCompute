/**
 * Spike de tool use. Doc 01 §5.2 / §5.3.
 *
 * Objetivo:  model -> toolCall -> execute -> role:'tool' -> model -> final
 *
 *   pnpm spike:tools                    # local, sin P2P
 *   pnpm spike:tools --key <publicKey>  # delegado: cierra el gate H1
 *
 * El segundo modo es el que resuelve el ultimo punto abierto de
 * `docs/qvac-findings.md`: si `delegate` y `modelConfig.tools` funcionan
 * combinados en la version instalada del SDK.
 *
 * Las tools se declaran SIN `handler` a proposito: asi el SDK NO las ejecuta y
 * el control queda de nuestro lado, que es lo que necesita el orchestrator.
 */

import { ensureEnvLoaded } from '@meshcompute/config';
import { completion, loadModel, unloadModel } from '@qvac/sdk';
import { QWEN3_1_7B_INST_Q4 } from '@qvac/sdk/models';

// GGML_DISABLE_VULKAN (ver .env) debe estar en process.env antes de que el
// primer loadModel spawnee el worker Bare.
ensureEnvLoaded();

const argv = process.argv.slice(2);
const keyIndex = argv.indexOf('--key');
const providerPublicKey = keyIndex >= 0 ? argv[keyIndex + 1] : undefined;
const delegated = Boolean(providerPublicKey);

if (providerPublicKey && !/^[0-9a-fA-F]{64}$/.test(providerPublicKey)) {
  console.error('ERROR: providerPublicKey must be a 64-character hex string.');
  process.exit(1);
}

/** Fuente de verdad local: el modelo NO puede inventar este valor. */
const PROVIDER_FIXTURE = {
  id: 'p_001',
  status: 'ONLINE',
  pricePer1kTokensAtomic: '1500',
};

const tools = [
  {
    // `type: 'function'` es obligatorio: sin el, el SDK no reconoce el objeto
    // como `Tool` y espera un ZodObject en `parameters`.
    type: 'function' as const,
    name: 'get_provider_status',
    description: 'Returns the marketplace status of the compute provider for this job.',
    parameters: {
      type: 'object' as const,
      properties: {
        providerId: { type: 'string' as const, description: 'Id of the provider.' },
      },
      required: ['providerId'],
    },
    // sin handler: queremos el evento, no la ejecucion automatica
  },
];

async function main(): Promise<void> {
  console.log(`mode: ${delegated ? 'DELEGATED (P2P)' : 'LOCAL'}`);
  console.log('loading QWEN3_1_7B_INST_Q4 with tools=true...');

  const loadStart = Date.now();
  const modelId = await loadModel({
    modelSrc: QWEN3_1_7B_INST_Q4,
    modelConfig: { ctx_size: 4096, tools: true },
    ...(delegated
      ? {
          delegate: {
            providerPublicKey: providerPublicKey!,
            timeout: 120_000,
            fallbackToLocal: false,
          },
        }
      : {}),
    onProgress: (progress: { percentage?: number }) => {
      if (progress.percentage !== undefined) {
        process.stdout.write(`\r  download: ${progress.percentage.toFixed(0)}%   `);
      }
    },
  } as unknown as Parameters<typeof loadModel>[0]);
  console.log(`\nloaded in ${Date.now() - loadStart} ms`);

  const history: Array<{ role: string; content: string }> = [
    {
      role: 'system',
      content:
        'Use the provided tools to gather evidence before answering. ' +
        'Never guess a value a tool can provide.',
    },
    {
      role: 'user',
      content:
        'What is the status of provider p_001? Use the tool, then answer with JSON only: ' +
        '{"providerStatus": "..."}',
    },
  ];

  // ---------------------------------------------------------- TURNO 1: tools
  console.log('\n--- turn 1: expecting a toolCall ---');
  const run1 = completion({
    modelId,
    history,
    stream: true,
    tools,
    generationParams: { temp: 0, seed: 42, reasoning_budget: 0 },
  } as unknown as Parameters<typeof completion>[0]);

  const observed: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
  for await (const event of run1.events) {
    if (event.type === 'toolCall') {
      const call = (event as { call: { id: string; name: string; arguments: Record<string, unknown> } }).call;
      observed.push(call);
      console.log(`  toolCall: ${call.name}(${JSON.stringify(call.arguments)})`);
      console.log(`    arguments typeof: ${typeof call.arguments} (expected: object, already parsed)`);
    } else if (event.type === 'toolError') {
      console.log(`  toolError: ${JSON.stringify((event as { error: unknown }).error)}`);
    }
  }
  const final1 = await run1.final;

  if (observed.length === 0) {
    console.log('  NO TOOL CALL. Raw output:');
    console.log(`  ${final1.contentText.slice(0, 400)}`);
    console.log('\n  The model did not emit a tool call. Consider toolDialect override.');
    await unloadModel({ modelId });
    process.exit(1);
  }

  // -------------------------------------------------- EJECUCION (lado nuestro)
  const call = observed[0]!;
  console.log(`\n--- executing ${call.name} locally ---`);
  const result = call.name === 'get_provider_status' ? PROVIDER_FIXTURE : { error: 'UNKNOWN_TOOL' };
  console.log(`  result: ${JSON.stringify(result)}`);

  // El schema del SDK declara `role` libre y NO existe tool_call_id.
  history.push({ role: 'assistant', content: final1.contentText });
  history.push({ role: 'tool', content: JSON.stringify(result) });

  // ---------------------------------------------------------- TURNO 2: final
  console.log('\n--- turn 2: expecting the final answer ---');
  const run2 = completion({
    modelId,
    history,
    stream: true,
    // Sin tools, para poder usar responseFormat (son mutuamente excluyentes).
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'provider_status_answer',
        schema: {
          type: 'object',
          properties: { providerStatus: { type: 'string' } },
          required: ['providerStatus'],
          additionalProperties: false,
        },
      },
    },
    generationParams: { temp: 0, seed: 42, reasoning_budget: 0 },
  } as unknown as Parameters<typeof completion>[0]);

  for await (const event of run2.events) {
    if (event.type === 'contentDelta') process.stdout.write(event.text);
  }
  const final2 = await run2.final;

  console.log('\n\n=== gate H1 ===');
  console.log(`  delegated + tools    : ${delegated ? 'YES' : 'n/a (local run)'}`);
  console.log(`  toolCall event       : OK (${observed.length})`);
  console.log(`  arguments pre-parsed : ${typeof call.arguments === 'object' ? 'OK' : 'NO'}`);
  console.log(`  role:'tool' accepted : OK`);
  console.log(`  second completion    : OK`);
  console.log(`  final                : ${final2.contentText}`);

  // El grounding real vive en grounding.ts; aqui solo se comprueba que el
  // modelo uso el valor de la tool y no uno inventado.
  const grounded = final2.contentText.includes(PROVIDER_FIXTURE.status);
  console.log(`  used the tool result : ${grounded ? 'OK' : 'NO — the model ignored it'}`);

  await unloadModel({ modelId });
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  console.error(
    '\nDoc 01 §37: if delegated inference + tools is not supported by the installed\n' +
      'SDK version, document the limitation in docs/qvac-findings.md. Do not fake\n' +
      'tool calls and do not replace QVAC with a cloud model.',
  );
  process.exit(1);
}
