/**
 * Limites del loop agentic.
 *
 * RNF-13 (doc 00 §27): "Todo loop agentic debe tener limites explicitos de
 * turns, retries y timeout." Doc 00 §11A: "Nunca permitir loops infinitos."
 */

export interface RetryPolicy {
  maxToolTurns: number;
  maxToolRetries: number;
  maxFinalSchemaRetries: number;
  toolTimeoutMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxToolTurns: 4,
  maxToolRetries: 1,
  maxFinalSchemaRetries: 1,
  toolTimeoutMs: 10_000,
};

/**
 * Detector de repeticion.
 *
 * Un modelo atascado repite la misma tool con los mismos argumentos hasta
 * agotar los turnos. Eso es F5 TOOL_LOOP, distinto de F6 MAX_TURNS (que es
 * simplemente quedarse sin presupuesto haciendo trabajo util).
 */
export class CallSignatureTracker {
  private readonly seen = new Set<string>();

  private static signature(name: string, args: Record<string, unknown>): string {
    // Claves ordenadas: {a:1,b:2} y {b:2,a:1} son la misma llamada.
    const sorted = Object.keys(args)
      .sort()
      .map((key) => `${key}=${JSON.stringify(args[key])}`)
      .join('&');
    return `${name}(${sorted})`;
  }

  /** true si esta llamada exacta ya se hizo antes. */
  isRepeat(name: string, args: Record<string, unknown>): boolean {
    return this.seen.has(CallSignatureTracker.signature(name, args));
  }

  record(name: string, args: Record<string, unknown>): void {
    this.seen.add(CallSignatureTracker.signature(name, args));
  }
}
