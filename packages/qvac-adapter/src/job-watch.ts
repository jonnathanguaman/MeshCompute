/**
 * Observa los trabajos de inferencia que ejecuta el worker local.
 *
 * El SDK no expone un hook "job delegado recibido", pero el addon llamacpp
 * loguea cada inferencia con el prompt completo:
 *
 *   { id: <modelId>, namespace: 'llamacpp-completion',
 *     message: 'Starting inference with prompt: [<JSON de mensajes>]' }
 *
 * (verificado en @qvac/llm-llamacpp@0.39.4; solo el contenido media binario
 * se censura, el texto va entero). En el Provider Agent toda inferencia es un
 * job delegado — el agente no ejecuta completions propias — asi que este
 * stream ES la lista de lo que mandan los consumers.
 *
 * Nota de privacidad (doc 00 §T-09): el prompt viaja cifrado por la red, pero
 * el provider lo ejecuta, asi que verlo en local es inherente a la inferencia
 * delegada — no una fuga.
 */

import { subscribeServerLogs } from '@qvac/sdk';

export interface InferenceJobMessage {
  role: string;
  content: string;
}

export interface InferenceJobEvent {
  /** modelId del worker que atiende el job. */
  modelId: string;
  /** Historial completo que envio el consumer. */
  messages: InferenceJobMessage[];
}

const PROMPT_LOG_PREFIX = 'Starting inference with prompt: ';

function toMessages(raw: string): InferenceJobMessage[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.map((item) => {
      const msg = item as { role?: unknown; content?: unknown };
      return {
        role: typeof msg.role === 'string' ? msg.role : '?',
        content:
          typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
      };
    });
  } catch {
    return undefined;
  }
}

/**
 * Llama a `onJob` por cada inferencia que ejecute el worker local, con el
 * prompt ya parseado. Devuelve la funcion para dejar de observar.
 *
 * Requiere que el worker este arrancado (despues de `QvacProvider.start()`).
 */
export function watchInferenceJobs(onJob: (job: InferenceJobEvent) => void): () => void {
  return subscribeServerLogs((log) => {
    const message = typeof log.message === 'string' ? log.message : undefined;
    if (!message || !message.startsWith(PROMPT_LOG_PREFIX)) return;

    const messages = toMessages(message.slice(PROMPT_LOG_PREFIX.length));
    if (!messages) return;

    onJob({ modelId: String(log.id ?? ''), messages });
  });
}
