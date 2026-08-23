/**
 * Calculo de costo determinista.
 *
 * UNA SOLA funcion pura, usada por la tool `calculate_expected_cost` Y por
 * `grounding.ts`. Si el tool y el validador calcularan distinto, el grounding
 * check seria ruido: rechazaria respuestas correctas y dejaria pasar otras.
 *
 * RNF-12 (doc 00 §27): las reglas de costo deben ser deterministas. El LLM no
 * participa en este calculo.
 *
 * Se usa BigInt porque las cantidades atomicas son enteros grandes en string
 * y con float se pierden centavos.
 */

export interface ExpectedCostInput {
  inputTokens: number;
  outputTokens: number;
  pricePer1kTokensAtomic: string;
}

/**
 * costo = ceil((inputTokens + outputTokens) * price / 1000)
 *
 * Se redondea hacia arriba: cobrar de menos por truncamiento seria un bug
 * economico silencioso, y el redondeo tiene que ser reproducible para que la
 * comparacion contra `quotedAmountAtomic` tenga sentido.
 */
export function computeExpectedCostAtomic(input: ExpectedCostInput): string {
  const { inputTokens, outputTokens, pricePer1kTokensAtomic } = input;

  if (!Number.isInteger(inputTokens) || inputTokens < 0) {
    throw new RangeError(`inputTokens must be a non-negative integer, got ${inputTokens}`);
  }
  if (!Number.isInteger(outputTokens) || outputTokens < 0) {
    throw new RangeError(`outputTokens must be a non-negative integer, got ${outputTokens}`);
  }
  if (!/^\d+$/.test(pricePer1kTokensAtomic)) {
    throw new RangeError(
      `pricePer1kTokensAtomic must be a non-negative integer string, got "${pricePer1kTokensAtomic}"`,
    );
  }

  const totalTokens = BigInt(inputTokens) + BigInt(outputTokens);
  const price = BigInt(pricePer1kTokensAtomic);
  const numerator = totalTokens * price;
  const denominator = 1000n;

  // ceil sin floats
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const result = remainder === 0n ? quotient : quotient + 1n;

  return result.toString();
}
