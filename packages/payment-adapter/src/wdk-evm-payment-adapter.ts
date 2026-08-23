import WDK from '@tetherto/wdk';
import WalletManagerEvm, { type WalletAccountEvm } from '@tetherto/wdk-wallet-evm';
import { PaymentAdapterError } from './errors.js';
import type { PaymentAdapter, PaymentRequest, PaymentResult } from './types.js';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WALLET_LABEL = 'meshcompute-testnet';

export const SUPPORTED_TESTNET_CHAIN_IDS = new Set([
  97, // BNB Smart Chain testnet
  80_002, // Polygon Amoy
  84_532, // Base Sepolia
  42_1614, // Arbitrum Sepolia
  43_113, // Avalanche Fuji
  11_155_111, // Ethereum Sepolia
  111_554_20, // Optimism Sepolia
]);

export interface WdkEvmPaymentConfig {
  rpcUrl: string;
  tokenAddress: string;
  seedPhrase: string;
  expectedChainId: number;
  accountIndex: number;
  maxTransferAtomic: string;
  maxFeeWei: string;
  rpcTimeoutMs: number;
}

export interface EvmPaymentAccount {
  getAddress(): Promise<string>;
  getBalance(): Promise<bigint>;
  getTokenBalance(tokenAddress: string): Promise<bigint>;
  quoteTransfer(options: {
    token: string;
    recipient: string;
    amount: bigint;
  }): Promise<{ fee: bigint }>;
  transfer(options: {
    token: string;
    recipient: string;
    amount: bigint;
  }): Promise<{ hash: string; fee: bigint }>;
}

export interface WdkEvmRuntime {
  account: EvmPaymentAccount;
  dispose(): void;
}

export interface WdkEvmDependencies {
  fetch: typeof globalThis.fetch;
  createRuntime(config: WdkEvmPaymentConfig): Promise<WdkEvmRuntime>;
}

function positiveAtomic(value: string): bigint | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const amount = BigInt(value);
  return amount > 0n ? amount : undefined;
}

function isAllowedTransfer(
  value: unknown,
  tokenAddress: string,
  maxTransferAtomic: bigint,
): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { token?: unknown; recipient?: unknown; amount?: unknown };
  if (
    typeof candidate.token !== 'string' ||
    candidate.token.toLowerCase() !== tokenAddress.toLowerCase()
  ) {
    return false;
  }
  if (typeof candidate.recipient !== 'string' || !EVM_ADDRESS.test(candidate.recipient)) return false;
  try {
    const amount = BigInt(candidate.amount as bigint);
    return amount > 0n && amount <= maxTransferAtomic;
  } catch {
    return false;
  }
}

async function defaultCreateRuntime(config: WdkEvmPaymentConfig): Promise<WdkEvmRuntime> {
  if (!WDK.isValidSeed(config.seedPhrase)) {
    throw new PaymentAdapterError(
      'INVALID_TREASURY_SEED',
      'The configured treasury seed phrase is not a valid BIP-39 mnemonic.',
    );
  }
  const maxTransferAtomic = BigInt(config.maxTransferAtomic);
  const wdk = new WDK(config.seedPhrase).registerWallet(WALLET_LABEL, WalletManagerEvm, {
    provider: config.rpcUrl,
    chainId: config.expectedChainId,
    transferMaxFee: BigInt(config.maxFeeWei),
  });
  wdk.registerPolicy({
    id: 'meshcompute-testnet-settlement',
    name: 'MeshCompute bounded testnet settlement',
    scope: 'project',
    wallet: WALLET_LABEL,
    rules: [
      {
        name: 'allow-configured-token-under-cap',
        operation: 'transfer',
        action: 'ALLOW',
        conditions: [({ args }) => isAllowedTransfer(args[0], config.tokenAddress, maxTransferAtomic)],
      },
    ],
  });
  const account = (await wdk.getAccount(
    WALLET_LABEL,
    config.accountIndex,
  )) as unknown as WalletAccountEvm;
  return {
    account,
    dispose: () => wdk.dispose([WALLET_LABEL]),
  };
}

async function readChainId(
  rpcUrl: string,
  timeoutMs: number,
  fetchImplementation: typeof globalThis.fetch,
): Promise<number> {
  let response: Response;
  try {
    response = await fetchImplementation(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new PaymentAdapterError('RPC_UNAVAILABLE', 'The configured testnet RPC is unavailable.');
  }
  if (!response.ok) {
    throw new PaymentAdapterError('RPC_UNAVAILABLE', 'The configured testnet RPC is unavailable.');
  }
  const body = (await response.json().catch(() => undefined)) as
    | { result?: unknown; error?: unknown }
    | undefined;
  if (!body || typeof body.result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(body.result)) {
    throw new PaymentAdapterError('RPC_UNAVAILABLE', 'The testnet RPC returned an invalid chain ID.');
  }
  return Number.parseInt(body.result.slice(2), 16);
}

export class WdkEvmPaymentAdapter implements PaymentAdapter {
  readonly mode = 'WDK_TESTNET' as const;
  readonly tokenAddress: string;
  private readonly dependencies: WdkEvmDependencies;
  private runtime: WdkEvmRuntime | undefined;

  constructor(
    private readonly config: WdkEvmPaymentConfig,
    dependencies: Partial<WdkEvmDependencies> = {},
  ) {
    this.tokenAddress = config.tokenAddress;
    this.dependencies = {
      fetch: dependencies.fetch ?? globalThis.fetch,
      createRuntime: dependencies.createRuntime ?? defaultCreateRuntime,
    };
    this.validateConfig();
  }

  async settle(input: PaymentRequest): Promise<PaymentResult> {
    const amount = positiveAtomic(input.amountAtomic);
    if (!amount) {
      throw new PaymentAdapterError('INVALID_PAYMENT_AMOUNT', 'Payment amount must be positive.');
    }
    if (amount > BigInt(this.config.maxTransferAtomic)) {
      throw new PaymentAdapterError(
        'INVALID_PAYMENT_AMOUNT',
        'Payment amount exceeds the configured testnet safety cap.',
      );
    }
    if (!EVM_ADDRESS.test(input.recipient)) {
      throw new PaymentAdapterError(
        'INVALID_RECIPIENT_ADDRESS',
        'The provider wallet is not a valid EVM address.',
      );
    }

    const runtime = await this.getRuntime();
    const transfer = {
      token: this.config.tokenAddress,
      recipient: input.recipient,
      amount,
    };
    let senderAddress: string;
    let tokenBalance: bigint;
    let gasBalance: bigint;
    try {
      [senderAddress, tokenBalance, gasBalance] = await Promise.all([
        runtime.account.getAddress(),
        runtime.account.getTokenBalance(this.config.tokenAddress),
        runtime.account.getBalance(),
      ]);
    } catch {
      throw new PaymentAdapterError('RPC_UNAVAILABLE', 'Wallet balances could not be read from testnet.');
    }
    if (tokenBalance < amount) {
      throw new PaymentAdapterError(
        'INSUFFICIENT_TOKEN_BALANCE',
        'The testnet treasury does not have enough demo tokens.',
      );
    }
    if (gasBalance <= 0n) {
      throw new PaymentAdapterError(
        'INSUFFICIENT_GAS_BALANCE',
        'The testnet treasury needs faucet funds for gas.',
      );
    }

    let quote: { fee: bigint };
    try {
      quote = await runtime.account.quoteTransfer(transfer);
    } catch {
      throw new PaymentAdapterError(
        'PAYMENT_FEE_QUOTE_FAILED',
        'WDK could not quote the testnet transfer fee.',
      );
    }
    if (quote.fee > BigInt(this.config.maxFeeWei)) {
      throw new PaymentAdapterError(
        'PAYMENT_FEE_LIMIT_EXCEEDED',
        'The quoted testnet gas fee exceeds the configured safety cap.',
      );
    }

    try {
      const result = await runtime.account.transfer(transfer);
      if (!/^0x[0-9a-fA-F]{64}$/.test(result.hash)) {
        throw new Error('Invalid transaction hash.');
      }
      return {
        status: 'PAID',
        mode: this.mode,
        txHash: result.hash,
        feeAtomic: result.fee.toString(),
        senderAddress,
        chainId: this.config.expectedChainId,
      };
    } catch (error) {
      if (error instanceof PaymentAdapterError) throw error;
      throw new PaymentAdapterError(
        'PAYMENT_BROADCAST_FAILED',
        'WDK could not broadcast the testnet token transfer.',
      );
    }
  }

  dispose(): void {
    this.runtime?.dispose();
    this.runtime = undefined;
  }

  private async getRuntime(): Promise<WdkEvmRuntime> {
    if (this.runtime) return this.runtime;
    const actualChainId = await readChainId(
      this.config.rpcUrl,
      this.config.rpcTimeoutMs,
      this.dependencies.fetch,
    );
    if (actualChainId !== this.config.expectedChainId) {
      throw new PaymentAdapterError(
        'INVALID_TESTNET_CHAIN',
        `RPC chain ${actualChainId} does not match configured testnet chain ${this.config.expectedChainId}.`,
      );
    }
    this.runtime = await this.dependencies.createRuntime(this.config);
    return this.runtime;
  }

  private validateConfig(): void {
    if (!EVM_ADDRESS.test(this.config.tokenAddress)) {
      throw new PaymentAdapterError(
        'INVALID_TOKEN_ADDRESS',
        'The configured testnet token address is invalid.',
      );
    }
    if (!SUPPORTED_TESTNET_CHAIN_IDS.has(this.config.expectedChainId)) {
      throw new PaymentAdapterError(
        'INVALID_TESTNET_CHAIN',
        'Only explicitly allowlisted EVM testnets can be used for settlement.',
      );
    }
    if (!positiveAtomic(this.config.maxTransferAtomic)) {
      throw new PaymentAdapterError('INVALID_PAYMENT_AMOUNT', 'The transfer safety cap is invalid.');
    }
    if (!positiveAtomic(this.config.maxFeeWei)) {
      throw new PaymentAdapterError('INVALID_PAYMENT_AMOUNT', 'The fee safety cap is invalid.');
    }
  }
}
