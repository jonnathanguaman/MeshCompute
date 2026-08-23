export const webConfig = {
  marketplaceApiUrl:
    process.env.NEXT_PUBLIC_MARKETPLACE_API_URL ?? 'http://127.0.0.1:4000',
  consumerAgentUrl:
    process.env.NEXT_PUBLIC_CONSUMER_AGENT_URL ?? 'http://127.0.0.1:5050',
  useMocks: process.env.NEXT_PUBLIC_USE_MOCKS === 'true',
  demoMode: process.env.NEXT_PUBLIC_DEMO_MODE !== 'false',
} as const;
