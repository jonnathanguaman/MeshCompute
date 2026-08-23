/**
 * Trace sanitizado de la ejecucion.
 *
 * RNF-14 (doc 00 §27) / doc 01 §18A: la UI puede visualizar decisiones de
 * tools, pero el trace NO contiene prompt ni raw tool results, y nada de esto
 * se persiste en el Marketplace central.
 *
 * El constructor de `ToolTraceItem` vive aqui y no inline en el orchestrator
 * para que exista un unico sitio donde comprobar que no se cuela un campo
 * nuevo con contenido.
 */

import type { FailureCodeId, ToolTraceItem } from '@meshcompute/contracts';

export interface TraceEntryInput {
  turn: number;
  toolName: string;
  argsValid: boolean;
  executionStatus: 'SUCCESS' | 'ERROR' | 'REJECTED';
  durationMs: number;
  retryCount: number;
  errorCode?: string;
}

export class TraceBuilder {
  private readonly items: ToolTraceItem[] = [];
  private readonly failures: FailureCodeId[] = [];

  add(entry: TraceEntryInput): void {
    // Construccion explicita campo a campo: un spread dejaria pasar
    // cualquier propiedad extra que se anadiera al input en el futuro.
    const item: ToolTraceItem = {
      turn: entry.turn,
      toolName: entry.toolName,
      argsValid: entry.argsValid,
      executionStatus: entry.executionStatus,
      durationMs: entry.durationMs,
      retryCount: entry.retryCount,
    };
    if (entry.errorCode !== undefined) item.errorCode = entry.errorCode;
    this.items.push(item);
  }

  /** Registra un codigo de la taxonomia (F1..F9) para el benchmark. */
  recordFailure(code: FailureCodeId): void {
    this.failures.push(code);
  }

  getItems(): ToolTraceItem[] {
    return [...this.items];
  }

  getFailures(): FailureCodeId[] {
    return [...this.failures];
  }

  countByStatus(status: 'SUCCESS' | 'ERROR' | 'REJECTED'): number {
    return this.items.filter((item) => item.executionStatus === status).length;
  }

  totalRetries(): number {
    return this.items.reduce((sum, item) => sum + item.retryCount, 0);
  }
}
