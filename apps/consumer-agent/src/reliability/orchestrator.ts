/**
 * Reliability Orchestrator — M2R.
 *
 * Doc 00 §11A / doc 01 §18A. Esta capa esta en el camino de `/v1/inference`;
 * no es un endpoint de juguete desconectado del job real.
 *
 * Estructura del loop, en dos fases (impuesto por findings §2: el SDK rechaza
 * combinar `responseFormat` con `tools`):
 *
 *   FASE TOOLS   completion(history, tools)           -- sin responseFormat
 *   FASE FINAL   completion(history, responseSchema)  -- sin tools, GBNF
 *
 * Garantias:
 *   - ninguna tool se ejecuta sin pasar whitelist -> scope -> Zod;
 *   - el numero de turnos, reintentos y timeouts esta acotado (RNF-13);
 *   - el final se compara contra los resultados reales (RNF-12);
 *   - si falta evidencia, se rehusa en vez de inventar.
 */

import type { Logger } from '@meshcompute/config';
import type {
  FailureCodeId,
  ReliabilityFinalStatus,
  ReliabilitySummary,
} from '@meshcompute/contracts';
import type { ChatMessage, DelegatedSession } from '@meshcompute/qvac-adapter';
import { extractJson } from '../hashing.js';
import {
  FINAL_JSON_SCHEMA,
  FINAL_SCHEMA_NAME,
  parseFinal,
  type FinalAnswer,
} from './final-schema.js';
import { checkGrounding, type ActualToolResults } from './grounding.js';
import { CallSignatureTracker, type RetryPolicy } from './retry-policy.js';
import {
  ToolExecutionError,
  checkScope,
  executeWithTimeout,
  findTool,
  toolDefinitions,
  toolNames,
  type ToolContext,
} from './tool-registry.js';
import { TraceBuilder } from './trace.js';

export interface OrchestratorOptions {
  session: DelegatedSession;
  ctx: ToolContext;
  policy: RetryPolicy;
  prompt: string;
  logger: Logger;
  /**
   * Modo baseline del benchmark: se sigue MIDIENDO todo (para poder comparar),
   * pero no se bloquea nada. Doc 01 §18B.
   */
  hardened?: boolean;
  /** Determinismo reproducible en el benchmark. */
  seed?: number;
}

export interface OrchestratorResult {
  /** Texto final que se devuelve a la UI. */
  content: string;
  summary: ReliabilitySummary;
  failures: FailureCodeId[];
  stats: { inputTokens?: number; outputTokens?: number; durationMs: number };
  /** Para el benchmark: que tools se ejecutaron realmente y con que resultado. */
  actualToolResults: ActualToolResults;
}

// El prompt DEBE nombrar los ids del contexto. Pedirle al modelo que "solo
// referencie el job y el provider del contexto actual" sin decirle cuales son
// le obliga a adivinar: Qwen3 manda los literales "job_id" y "provider_id", el
// guardia de scope los rechaza y la cadena muere en el turno 1.
// Es la causa de F9 TOOL_SCOPE_VIOLATION (80 en baseline / 60 en hardened en la
// corrida del 22/08 con tooluse-llm).
// No hay fuga de privacidad: estos ids ya viajan al provider dentro de los
// argumentos de las tools. El prompt del usuario es lo que nunca sale de aqui.
function buildSystemPrompt(ctx: { jobId: string; providerId: string }): string {
  return [
    'You are the reliability layer of a MeshCompute compute job.',
    'Use the provided tools to gather evidence before answering. Never guess a value',
    'that a tool can provide.',
    `You are working on exactly one job and one provider: jobId="${ctx.jobId}" and`,
    `providerId="${ctx.providerId}". Always pass these exact values to the tools.`,
    'Never invent, alter or use placeholder ids: any other value is rejected.',
    'Do not call a tool you have already called successfully; reuse its result.',
    'Call each of the three tools exactly once, then answer immediately.',
    // Decirle la forma EXACTA de la salida es lo que le permite reconocer que
    // ya tiene bastante y parar. Sin esto solo se le pedia "a single JSON
    // object" sin nombrar un solo campo, asi que seguia pidiendo tools hasta
    // agotar los turnos y acababa forzado a un refusal aun teniendo toda la
    // evidencia: los 10 NORMAL_CHAIN fallaban asi.
    // Los argumentos de calculate_expected_cost salen de las otras dos tools.
    // Si el modelo se los inventa, la tool devuelve un coste correcto para unos
    // datos equivocados y el grounding lo da por bueno: agujero silencioso.
    'Call calculate_expected_cost with inputTokens and outputTokens taken from the',
    'get_job_metadata result, and pricePer1kTokensAtomic taken from the',
    'get_provider_status result. Never invent those numbers.',
    'When you have all the evidence, answer with EXACTLY this JSON object:',
    '{"providerStatus":"ONLINE"|"OFFLINE"|"BUSY",',
    '"expectedAmountAtomic":"<integer as string>",',
    '"quoteConsistent":true|false,',
    // evidence NO son citas: grounding.ts comprueba cada entrada contra el Set
    // de tools ejecutadas con exito, asi que deben ser los nombres exactos.
    '"evidence":["get_provider_status","get_job_metadata","calculate_expected_cost"]}.',
    'The evidence array must contain the exact names of the tools you called',
    'successfully, nothing else. Do not put values or sentences in it.',
    // Copiar, no recalcular. Qwen3-1.7B rehace la aritmetica y se equivoca
    // (escribio "150" donde la tool devolvia "2310"), lo que dispara
    // GROUNDING_MISMATCH aunque la evidencia fuese correcta.
    'providerStatus: copy the status field from the get_provider_status result verbatim.',
    'expectedAmountAtomic: copy the expectedAmountAtomic field from the',
    'calculate_expected_cost result verbatim. Never recompute it yourself.',
    'quoteConsistent: compare the two strings character by character.',
    'It is true ONLY if quotedAmountAtomic from get_job_metadata is exactly equal',
    'to expectedAmountAtomic. If they differ in any way, it is false.',
    // Un 1.7B falla esta comparacion y responde true por defecto. Un ejemplo
    // trabajado en ambos sentidos es lo que la desbloquea.
    'Example: expectedAmountAtomic "2310" and quotedAmountAtomic "2800" are different,',
    'so quoteConsistent is false. Only "2310" and "2310" would make it true.',
    'Add no other fields.',
    'If any required source cannot be retrieved, answer with',
    '{"status":"INSUFFICIENT_EVIDENCE","reason":"..."} instead of guessing.',
  ].join(' ');
}

export class ReliabilityOrchestrator {
  async run(options: OrchestratorOptions): Promise<OrchestratorResult> {
    const { session, ctx, policy, prompt, logger } = options;
    const hardened = options.hardened ?? true;

    const trace = new TraceBuilder();
    const actualToolResults: ActualToolResults = new Map();
    const executedSuccessfully = new Set<string>();
    const repeats = new CallSignatureTracker();
    let evidenceCompleteNudged = false;

    const history: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(ctx) },
      { role: 'user', content: prompt },
    ];

    const startedAt = Date.now();
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let requiredToolsSeen = 0;

    let refusalReason: string | undefined;
    let terminal: 'MAX_TURNS' | 'TOOL_FAILURE' | undefined;

    // ---------------------------------------------------------------- FASE TOOLS
    for (let turn = 1; turn <= policy.maxToolTurns; turn += 1) {
      const outcome = await session.complete({
        history,
        tools: toolDefinitions(),
        generation: {
          temperature: 0,
          disableReasoning: true,
          ...(options.seed !== undefined ? { seed: options.seed } : {}),
        },
      });

      inputTokens = outcome.stats.inputTokens ?? inputTokens;
      outputTokens = (outputTokens ?? 0) + (outcome.stats.outputTokens ?? 0);

      // Sin tool calls: el modelo cree haber terminado. Se pasa a la fase final.
      if (outcome.toolCalls.length === 0) {
        history.push({ role: 'assistant', content: outcome.content });
        break;
      }

      // El turno del asistente que ORIGINO estas tool calls tiene que ir al
      // historial ANTES que sus resultados. Sin el, el modelo recibe mensajes
      // role:tool huerfanos, no reconoce haber pedido ya esos datos, y repite
      // las mismas tools cada vuelta. Es la causa de F5 TOOL_LOOP (106 en
      // hardened en la corrida del 22/08 con tooluse-llm).
      //
      // No basta con empujar outcome.content: con Qwen3 la tool call viaja por
      // el canal estructurado y el texto llega VACIO, asi que el turno no diria
      // nada. Hay que serializar las llamadas dentro del content, porque el
      // history del SDK solo admite {role, content} de tipo string.
      const requested = outcome.toolCalls
        .map((c) => `${c.name}(${JSON.stringify(c.arguments)})`)
        .join(', ');
      history.push({
        role: 'assistant',
        content: outcome.content?.trim()
          ? `${outcome.content.trim()}\n[called: ${requested}]`
          : `[called: ${requested}]`,
      });

      for (const call of outcome.toolCalls) {
        requiredToolsSeen += 1;
        const callStart = Date.now();

        // --- Guarda 1: whitelist (F1) ---
        const tool = findTool(call.name);
        if (!tool) {
          trace.add({
            turn,
            toolName: call.name,
            argsValid: false,
            executionStatus: 'REJECTED',
            durationMs: Date.now() - callStart,
            retryCount: 0,
            errorCode: 'WRONG_TOOL',
          });
          trace.recordFailure('F1');
          logger.warn({ event: 'tool_rejected', jobId: ctx.jobId, tool: call.name, reason: 'WRONG_TOOL' });
          history.push({
            role: 'tool',
            content: JSON.stringify({
              error: 'UNKNOWN_TOOL',
              message: `No tool named "${call.name}". Available: ${toolNames().join(', ')}`,
            }),
          });
          continue;
        }

        // --- Guarda 2: scope (F9) ---
        const violation = checkScope(call.arguments, ctx);
        if (violation && hardened) {
          trace.add({
            turn,
            toolName: call.name,
            argsValid: false,
            executionStatus: 'REJECTED',
            durationMs: Date.now() - callStart,
            retryCount: 0,
            errorCode: 'TOOL_SCOPE_VIOLATION',
          });
          trace.recordFailure('F9');
          logger.warn({
            event: 'tool_scope_violation',
            jobId: ctx.jobId,
            tool: call.name,
            field: violation.field,
          });
          history.push({
            role: 'tool',
            content: JSON.stringify({
              error: 'TOOL_SCOPE_VIOLATION',
              message:
                `You may only query ${violation.field}="${violation.expected}" ` +
                `for this job. Requested "${violation.received}" is out of scope.`,
            }),
          });
          continue;
        }
        if (violation) trace.recordFailure('F9'); // baseline: se mide, no se bloquea

        // --- Guarda 3: Zod (F2), con una sola correccion ---
        const parsedArgs = tool.schema.safeParse(call.arguments);
        let argsRetries = 0;
        // Args que finalmente se pasan a la tool. En hardened solo se llega
        // aqui con args validados; en baseline se deja pasar lo crudo.
        let effectiveArgs: unknown = parsedArgs.success ? parsedArgs.data : call.arguments;

        if (!parsedArgs.success && hardened) {
          trace.recordFailure('F2');
          const detail = parsedArgs.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ');

          if (policy.maxToolRetries > 0) {
            // Se devuelve el error de validacion al modelo como resultado de
            // tool. NUNCA se ejecuta la tool con los args invalidos (T-12).
            argsRetries = 1;
            history.push({
              role: 'tool',
              content: JSON.stringify({
                error: 'INVALID_ARGUMENTS',
                tool: call.name,
                message: detail,
              }),
            });
          }

          trace.add({
            turn,
            toolName: call.name,
            argsValid: false,
            executionStatus: 'REJECTED',
            durationMs: Date.now() - callStart,
            retryCount: argsRetries,
            errorCode: 'INVALID_ARGS',
          });
          logger.warn({ event: 'tool_invalid_args', jobId: ctx.jobId, tool: call.name });
          continue;
        }
        if (!parsedArgs.success) {
          // baseline: se mide y se intenta ejecutar igual, que es justamente
          // el comportamiento que el benchmark debe exponer como fragil.
          trace.recordFailure('F2');
          effectiveArgs = call.arguments;
        }

        // --- Guarda 4: repeticion (F5) ---
        if (repeats.isRepeat(call.name, call.arguments)) {
          trace.recordFailure('F5');
          logger.warn({ event: 'tool_loop_detected', jobId: ctx.jobId, tool: call.name });
        }
        repeats.record(call.name, call.arguments);

        // --- Ejecucion, con un retry como maximo ---
        let retryCount = 0;
        let executed = false;
        let lastError: ToolExecutionError | Error | undefined;

        for (let attempt = 0; attempt <= policy.maxToolRetries; attempt += 1) {
          try {
            const result = await executeWithTimeout(tool, effectiveArgs, ctx);
            actualToolResults.set(call.name, result);
            executedSuccessfully.add(call.name);
            executed = true;

            trace.add({
              turn,
              toolName: call.name,
              // Refleja SIEMPRE el veredicto de Zod, no si se ejecuto. En
              // baseline una tool puede correr con args invalidos; marcarla
              // como valida haria que el modo fragil puntuase mejor en
              // validArgumentRate, que es justo lo contrario de la verdad.
              argsValid: parsedArgs.success,
              executionStatus: 'SUCCESS',
              durationMs: Date.now() - callStart,
              retryCount,
            });
            history.push({ role: 'tool', content: JSON.stringify(result) });
            logger.debug({ event: 'tool_executed', jobId: ctx.jobId, tool: call.name });
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < policy.maxToolRetries) {
              retryCount += 1;
              continue;
            }
          }
        }

        if (!executed) {
          const code =
            lastError instanceof ToolExecutionError ? lastError.code : 'TOOL_ERROR';
          trace.add({
            turn,
            toolName: call.name,
            argsValid: parsedArgs.success,
            executionStatus: 'ERROR',
            durationMs: Date.now() - callStart,
            retryCount,
            errorCode: code,
          });
          if (code === 'TOOL_TIMEOUT') trace.recordFailure('F8');

          logger.warn({
            event: 'tool_failed',
            jobId: ctx.jobId,
            tool: call.name,
            errorCode: code,
            retryCount,
          });

          // Doc 01 §18A: tras el retry, no se inventa el dato (T-13).
          history.push({
            role: 'tool',
            content: JSON.stringify({
              error: code,
              tool: call.name,
              message: 'The tool failed after retrying. Do not guess this value.',
            }),
          });
          if (hardened) {
            terminal = 'TOOL_FAILURE';
            refusalReason = `Tool ${call.name} failed (${code}) after ${retryCount} retries.`;
          }
        }
      }

      if (terminal === 'TOOL_FAILURE') break;

      // Cuando ya se ejecutaron con exito TODAS las tools disponibles, el modelo
      // tiene toda la evidencia que el sistema puede darle. Sin un empujon
      // explicito sigue pidiendo las mismas (F5) hasta agotar los turnos, y ahi
      // la fase final lo fuerza a un refusal aunque la evidencia estuviera
      // completa. Es exactamente como fallaban los 10 NORMAL_CHAIN.
      // Se emite una sola vez por job.
      if (terminal === undefined && !evidenceCompleteNudged
        && executedSuccessfully.size >= toolNames().length) {
        evidenceCompleteNudged = true;
        history.push({
          role: 'user',
          content:
            'You now have every tool result you need. Do not call any more tools. '
            + 'Produce the final JSON object now, using only the values above.',
        });
        logger.debug({ event: 'evidence_complete_nudge', jobId: ctx.jobId, turn });
      }

      if (turn === policy.maxToolTurns) {
        terminal = 'MAX_TURNS';
        trace.recordFailure('F6');
        refusalReason = `Reached MAX_TOOL_TURNS (${policy.maxToolTurns}) without a final answer.`;
        logger.warn({ event: 'max_tool_turns_reached', jobId: ctx.jobId });
      }
    }

    // ---------------------------------------------------------------- FASE FINAL
    // Se emite SIN tools y CON responseSchema: llama.cpp restringe la
    // generacion al JSON Schema via GBNF (findings §2).
    let finalText = '';
    let schemaPassed = false;
    let groundingPassed = false;
    let answer: FinalAnswer | undefined;

    const maxFinalAttempts = hardened ? policy.maxFinalSchemaRetries + 1 : 1;

    for (let attempt = 1; attempt <= maxFinalAttempts; attempt += 1) {
      const finalOutcome = await session.complete({
        history: [
          ...history,
          {
            role: 'user',
            content:
              terminal === undefined
                ? 'Now produce the final JSON object based only on the tool results above.'
                : `You could not gather all evidence (${refusalReason}). ` +
                  'Answer with the INSUFFICIENT_EVIDENCE object.',
          },
        ],
        ...(hardened
          ? { responseSchema: { name: FINAL_SCHEMA_NAME, schema: FINAL_JSON_SCHEMA } }
          : {}),
        generation: {
          temperature: 0,
          disableReasoning: true,
          ...(options.seed !== undefined ? { seed: options.seed } : {}),
        },
      });

      outputTokens = (outputTokens ?? 0) + (finalOutcome.stats.outputTokens ?? 0);
      finalText = finalOutcome.content;

      const parsed = parseFinal(finalText, extractJson);

      if (parsed.kind === 'ANSWER') {
        schemaPassed = true;
        answer = parsed.value;
        break;
      }
      if (parsed.kind === 'REFUSAL') {
        schemaPassed = true;
        refusalReason = parsed.value.reason;
        break;
      }

      // INVALID: una reparacion y, si persiste, F7.
      if (attempt === maxFinalAttempts) {
        trace.recordFailure('F7');
        logger.warn({ event: 'final_schema_invalid', jobId: ctx.jobId, error: parsed.error });
      } else {
        history.push({
          role: 'tool',
          content: JSON.stringify({
            error: 'INVALID_FINAL_SCHEMA',
            message: parsed.error,
          }),
        });
      }
    }

    // ------------------------------------------------------------- GROUNDING
    if (answer) {
      const grounding = checkGrounding(answer, actualToolResults, executedSuccessfully);
      groundingPassed = grounding.passed;

      if (!grounding.passed) {
        for (const issue of grounding.issues) {
          trace.recordFailure(issue.failureCode);
          logger.warn({
            event: 'grounding_mismatch',
            jobId: ctx.jobId,
            field: issue.field,
            reason: issue.reason,
          });
        }
        if (hardened) {
          refusalReason =
            refusalReason ??
            `GROUNDING_MISMATCH on ${grounding.issues.map((i) => i.field).join(', ')}`;
        }
      }
    }

    // -------------------------------------------------------------- VEREDICTO
    let status: ReliabilityFinalStatus;
    if (answer && schemaPassed && groundingPassed && terminal === undefined) {
      status = 'PASSED';
    } else if (!schemaPassed) {
      status = 'FAILED';
    } else if (answer && !groundingPassed) {
      // Un final bien formado pero no fundamentado es un fallo, no una negativa.
      status = hardened ? 'FAILED' : 'PASSED';
    } else {
      status = 'REFUSED';
    }

    const summary: ReliabilitySummary = {
      status,
      requiredTools: requiredToolsSeen,
      successfulTools: trace.countByStatus('SUCCESS'),
      failedTools: trace.countByStatus('ERROR') + trace.countByStatus('REJECTED'),
      retries: trace.totalRetries(),
      schemaPassed,
      groundingPassed,
      trace: trace.getItems(),
    };
    if (refusalReason !== undefined && status !== 'PASSED') {
      summary.refusalReason = refusalReason;
    }

    return {
      content: finalText,
      summary,
      failures: trace.getFailures(),
      stats: { inputTokens, outputTokens, durationMs: Date.now() - startedAt },
      actualToolResults,
    };
  }
}
