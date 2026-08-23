import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createPaymentAdapter } from '../src/services/payment-adapter.factory.js';

const validTestnetEnvironment = {
  PAYMENT_MODE: 'WDK_TESTNET',
  EVM_RPC_URL: 'https://sepolia.example.invalid',
  TESTNET_TOKEN_ADDRESS: '0x1111111111111111111111111111111111111111',
  TREASURY_SEED_PHRASE: 'demo-only-seed-is-validated-by-wdk-before-use',
  TOKEN_DECIMALS: '6',
  WDK_TESTNET_CHAIN_ID: '11155111',
} satisfies NodeJS.ProcessEnv;

describe('payment configuration safety', () => {
  it('defaults to the zero-risk simulated adapter', () => {
    const config = loadConfig({});
    expect(config.PAYMENT_MODE).toBe('SIMULATED');
    expect(createPaymentAdapter(config).mode).toBe('SIMULATED');
  });

  it('requires every private testnet setting only when WDK is enabled', () => {
    expect(() => loadConfig({ PAYMENT_MODE: 'WDK_TESTNET' })).toThrow(
      /WDK_TESTNET requires EVM_RPC_URL, TESTNET_TOKEN_ADDRESS, TREASURY_SEED_PHRASE/,
    );
  });

  it('loads WDK_TESTNET and its backwards-compatible TESTNET alias', () => {
    expect(loadConfig(validTestnetEnvironment).PAYMENT_MODE).toBe('WDK_TESTNET');
    expect(
      loadConfig({ ...validTestnetEnvironment, PAYMENT_MODE: 'TESTNET' }).PAYMENT_MODE,
    ).toBe('WDK_TESTNET');
  });

  it('rejects malformed token addresses and non-six-decimal demo tokens', () => {
    expect(() =>
      loadConfig({ ...validTestnetEnvironment, TESTNET_TOKEN_ADDRESS: 'not-an-address' }),
    ).toThrow(/TESTNET_TOKEN_ADDRESS/);
    expect(() => loadConfig({ ...validTestnetEnvironment, TOKEN_DECIMALS: '18' })).toThrow(
      /TOKEN_DECIMALS=6/,
    );
  });

  it('refuses mainnet even when every other WDK setting is present', () => {
    const config = loadConfig({ ...validTestnetEnvironment, WDK_TESTNET_CHAIN_ID: '1' });
    expect(() => createPaymentAdapter(config)).toThrow(/refuses non-allowlisted chain ID 1/);
  });
});
