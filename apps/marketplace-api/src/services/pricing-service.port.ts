import type { PricingService } from '@meshcompute/contracts';

// Temporary core-safe default. Persona 2B can inject its implementation without
// changing JobService or routes. PER_JOB means the provider snapshot price is the quote.
export const providerSnapshotPricing: PricingService = {
  async quote(input) {
    return { quotedAmountAtomic: input.priceAtomic };
  },
};
