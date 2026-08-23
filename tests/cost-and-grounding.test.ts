/**
 * T-14 grounding mismatch, F4 hallucinated result, paridad tool/validator.
 *
 * RNF-12: las reglas de grounding y costo son deterministas. El LLM no se
 * auto-califica, asi que estas comprobaciones deben poder correr sin modelo.
 */

import { describe, expect, it } from 'vitest';
import { computeExpectedCostAtomic } from '../apps/consumer-agent/src/reliability/cost.js';
import { checkGrounding } from '../apps/consumer-agent/src/reliability/grounding.js';
import type { FinalAnswer } from '../apps/consumer-agent/src/reliability/final-schema.js';

describe('computeExpectedCostAtomic', () => {
  it('reproduce el ejemplo del doc 00 §11A', () => {
    // (1200 + 340) * 1500 / 1000 = 2310
    expect(
      computeExpectedCostAtomic({
        inputTokens: 1200,
        outputTokens: 340,
        pricePer1kTokensAtomic: '1500',
      }),
    ).toBe('2310');
  });

  it('redondea hacia arriba', () => {
    // 1 * 2000 / 1000 = 2 exacto
    expect(
      computeExpectedCostAtomic({
        inputTokens: 1,
        outputTokens: 0,
        pricePer1kTokensAtomic: '2000',
      }),
    ).toBe('2');
    // 1 * 1500 / 1000 = 1.5 -> 2
    expect(
      computeExpectedCostAtomic({
        inputTokens: 1,
        outputTokens: 0,
        pricePer1kTokensAtomic: '1500',
      }),
    ).toBe('2');
  });

  it('no pierde precision con cantidades grandes', () => {
    // Un float perderia digitos aqui; BigInt no.
    const result = computeExpectedCostAtomic({
      inputTokens: 999_999_999,
      outputTokens: 1,
      pricePer1kTokensAtomic: '999999999999',
    });
    expect(result).toBe('999999999999000000');
  });

  it('rechaza entradas invalidas en vez de devolver NaN', () => {
    expect(() =>
      computeExpectedCostAtomic({
        inputTokens: -1,
        outputTokens: 0,
        pricePer1kTokensAtomic: '1000',
      }),
    ).toThrow(RangeError);

    expect(() =>
      computeExpectedCostAtomic({
        inputTokens: 1,
        outputTokens: 0,
        pricePer1kTokensAtomic: 'abc',
      }),
    ).toThrow(RangeError);
  });
});

const providerResult = {
  id: 'p_001',
  status: 'ONLINE',
  pricePer1kTokensAtomic: '1500',
};
const jobResult = {
  id: 'job_123',
  inputTokens: 1200,
  outputTokens: 340,
  quotedAmountAtomic: '2800',
};
const costResult = { expectedAmountAtomic: '2310' };

function actuals(): Map<string, unknown> {
  return new Map<string, unknown>([
    ['get_provider_status', providerResult],
    ['get_job_metadata', jobResult],
    ['calculate_expected_cost', costResult],
  ]);
}

const allTools = new Set([
  'get_provider_status',
  'get_job_metadata',
  'calculate_expected_cost',
]);

const goodAnswer: FinalAnswer = {
  providerStatus: 'ONLINE',
  expectedAmountAtomic: '2310',
  quoteConsistent: false,
  evidence: ['get_provider_status', 'get_job_metadata', 'calculate_expected_cost'],
};

describe('checkGrounding', () => {
  it('acepta una respuesta fundamentada', () => {
    const result = checkGrounding(goodAnswer, actuals(), allTools);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('T-14: tool devuelve 2310 y el modelo afirma 2800 -> groundingPassed=false', () => {
    const result = checkGrounding(
      { ...goodAnswer, expectedAmountAtomic: '2800' },
      actuals(),
      allTools,
    );
    expect(result.passed).toBe(false);
    const issue = result.issues.find((i) => i.field === 'expectedAmountAtomic');
    expect(issue?.failureCode).toBe('F4');
    expect(issue?.expected).toBe('2310');
    expect(issue?.claimed).toBe('2800');
  });

  it('F3: contradecir el status devuelto por la tool', () => {
    const result = checkGrounding(
      { ...goodAnswer, providerStatus: 'OFFLINE' },
      actuals(),
      allTools,
    );
    expect(result.passed).toBe(false);
    expect(result.issues.find((i) => i.field === 'providerStatus')?.failureCode).toBe('F3');
  });

  it('F3: recalcula quoteConsistent en vez de aceptarlo', () => {
    // 2310 !== 2800, asi que quoteConsistent solo puede ser false.
    const result = checkGrounding(
      { ...goodAnswer, quoteConsistent: true },
      actuals(),
      allTools,
    );
    expect(result.passed).toBe(false);
    expect(result.issues.find((i) => i.field === 'quoteConsistent')?.failureCode).toBe('F3');
  });

  it('F4: citar como evidencia una tool que no se ejecuto', () => {
    const executed = new Set(['get_provider_status', 'get_job_metadata']);
    const partial = new Map<string, unknown>([
      ['get_provider_status', providerResult],
      ['get_job_metadata', jobResult],
    ]);

    const result = checkGrounding(goodAnswer, partial, executed);
    expect(result.passed).toBe(false);
    const issue = result.issues.find(
      (i) => i.field === 'evidence' && i.claimed === 'calculate_expected_cost',
    );
    expect(issue?.failureCode).toBe('F4');
  });

  it('recalcula el coste si el modelo se salto la calculadora', () => {
    // Sin resultado de calculate_expected_cost, el validador lo recalcula con
    // la MISMA funcion pura: saltarse la tool no permite colar otro numero.
    const executed = new Set(['get_provider_status', 'get_job_metadata']);
    const partial = new Map<string, unknown>([
      ['get_provider_status', providerResult],
      ['get_job_metadata', jobResult],
    ]);

    const answer: FinalAnswer = {
      ...goodAnswer,
      expectedAmountAtomic: '9999',
      evidence: ['get_provider_status', 'get_job_metadata'],
    };
    const result = checkGrounding(answer, partial, executed);
    expect(result.passed).toBe(false);
    expect(
      result.issues.find((i) => i.field === 'expectedAmountAtomic')?.expected,
    ).toBe('2310');
  });
});
