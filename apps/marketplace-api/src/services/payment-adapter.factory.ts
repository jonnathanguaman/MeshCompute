import {
  SimulatedPaymentAdapter,
  SUPPORTED_TESTNET_CHAIN_IDS,
  WdkEvmPaymentAdapter,
  type PaymentAdapter,
} from '@meshcompute/payment-adapter';
import type { MarketplaceConfig } from '../config.js';

export function createPaymentAdapter(config: MarketplaceConfig): PaymentAdapter {
  if (config.PAYMENT_MODE === 'SIMULATED') return new SimulatedPaymentAdapter();

  if (!SUPPORTED_TESTNET_CHAIN_IDS.has(config.WDK_TESTNET_CHAIN_ID)) {
    throw new Error(
      `WDK_TESTNET refuses non-allowlisted chain ID ${config.WDK_TESTNET_CHAIN_ID}.`,
    );
  }
  if (!config.EVM_RPC_URL || !config.TESTNET_TOKEN_ADDRESS || !config.TREASURY_SEED_PHRASE) {
    throw new Error('WDK_TESTNET payment configuration is incomplete.');
  }
  return new WdkEvmPaymentAdapter({
    rpcUrl: config.EVM_RPC_URL,
    tokenAddress: config.TESTNET_TOKEN_ADDRESS,
    seedPhrase: config.TREASURY_SEED_PHRASE,
    expectedChainId: config.WDK_TESTNET_CHAIN_ID,
    accountIndex: config.WDK_ACCOUNT_INDEX,
    maxTransferAtomic: config.WDK_MAX_TRANSFER_ATOMIC,
    maxFeeWei: config.WDK_MAX_FEE_WEI,
    rpcTimeoutMs: config.WDK_RPC_TIMEOUT_MS,
  });
}
