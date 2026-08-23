import { describe, expect, it, vi } from 'vitest';
import {
  PaymentAdapterError,
  SimulatedPaymentAdapter,
  WdkEvmPaymentAdapter,
  type EvmPaymentAccount,
  type WdkEvmPaymentConfig,
  type WdkEvmRuntime,
} from '../src/index.js';

const config: WdkEvmPaymentConfig = {
  rpcUrl: 'https://rpc.test.invalid',
  tokenAddress: '0x1111111111111111111111111111111111111111',
  seedPhrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  expectedChainId: 11_155_111,
  accountIndex: 0,
  maxTransferAtomic: '1000000',
  maxFeeWei: '10000000000000000',
  rpcTimeoutMs: 1_000,
};

function rpcResponse(chainId: number): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: 1, result: `0x${chainId.toString(16)}` }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function mockRuntime(overrides: Partial<EvmPaymentAccount> = {}) {
  const account: EvmPaymentAccount = {
    getAddress: vi.fn().mockResolvedValue('0x2222222222222222222222222222222222222222'),
    getBalance: vi.fn().mockResolvedValue(10n ** 18n),
    getTokenBalance: vi.fn().mockResolvedValue(5_000_000n),
    quoteTransfer: vi.fn().mockResolvedValue({ fee: 100_000n }),
    transfer: vi.fn().mockResolvedValue({
      hash: `0x${'a'.repeat(64)}`,
      fee: 90_000n,
    }),
    ...overrides,
  };
  const runtime: WdkEvmRuntime = { account, dispose: vi.fn() };
  return { account, runtime };
}

describe('SimulatedPaymentAdapter', () => {
  it('returns an explicitly simulated transaction identifier', async () => {
    const result = await new SimulatedPaymentAdapter().settle({
      jobId: 'job_01',
      recipient: 'provider-wallet',
      amountAtomic: '2000',
    });
    expect(result.mode).toBe('SIMULATED');
    expect(result.txHash).toMatch(/^sim_job_01_/);
  });

  it('rejects a zero payment', async () => {
    await expect(
      new SimulatedPaymentAdapter().settle({
        jobId: 'job_01',
        recipient: 'provider-wallet',
        amountAtomic: '0',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PAYMENT_AMOUNT' });
  });
});

describe('WdkEvmPaymentAdapter', () => {
  it('quotes and broadcasts one real ERC-20 transfer through the WDK account', async () => {
    const { account, runtime } = mockRuntime();
    const fetchMock = vi.fn().mockResolvedValue(rpcResponse(config.expectedChainId));
    const createRuntime = vi.fn().mockResolvedValue(runtime);
    const adapter = new WdkEvmPaymentAdapter(config, {
      fetch: fetchMock,
      createRuntime,
    });

    const result = await adapter.settle({
      jobId: 'job_01',
      recipient: '0x3333333333333333333333333333333333333333',
      amountAtomic: '2000',
    });

    expect(result).toMatchObject({
      status: 'PAID',
      mode: 'WDK_TESTNET',
      txHash: `0x${'a'.repeat(64)}`,
      feeAtomic: '90000',
      senderAddress: '0x2222222222222222222222222222222222222222',
      chainId: 11_155_111,
    });
    expect(account.quoteTransfer).toHaveBeenCalledOnce();
    expect(account.transfer).toHaveBeenCalledOnce();
    expect(account.transfer).toHaveBeenCalledWith({
      token: config.tokenAddress,
      recipient: '0x3333333333333333333333333333333333333333',
      amount: 2000n,
    });
    adapter.dispose();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it('rejects an RPC connected to a different chain before constructing a wallet', async () => {
    const createRuntime = vi.fn();
    const adapter = new WdkEvmPaymentAdapter(config, {
      fetch: vi.fn().mockResolvedValue(rpcResponse(84_532)),
      createRuntime,
    });
    await expect(
      adapter.settle({
        jobId: 'job_01',
        recipient: '0x3333333333333333333333333333333333333333',
        amountAtomic: '2000',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TESTNET_CHAIN' });
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it('hard-blocks mainnet chain IDs', () => {
    expect(
      () => new WdkEvmPaymentAdapter({ ...config, expectedChainId: 1 }),
    ).toThrowError(PaymentAdapterError);
  });

  it('enforces token, gas, transfer and fee safety checks before broadcast', async () => {
    const insufficientToken = mockRuntime({ getTokenBalance: vi.fn().mockResolvedValue(100n) });
    const adapter = new WdkEvmPaymentAdapter(config, {
      fetch: vi.fn().mockResolvedValue(rpcResponse(config.expectedChainId)),
      createRuntime: vi.fn().mockResolvedValue(insufficientToken.runtime),
    });
    await expect(
      adapter.settle({
        jobId: 'job_01',
        recipient: '0x3333333333333333333333333333333333333333',
        amountAtomic: '2000',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_TOKEN_BALANCE' });
    expect(insufficientToken.account.transfer).not.toHaveBeenCalled();

    await expect(
      adapter.settle({
        jobId: 'job_02',
        recipient: '0x3333333333333333333333333333333333333333',
        amountAtomic: '1000001',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PAYMENT_AMOUNT' });
  });
});
