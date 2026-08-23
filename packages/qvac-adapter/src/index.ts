/**
 * @meshcompute/qvac-adapter
 *
 * Unico paquete del monorepo que importa `@qvac/sdk`. Doc 01 §6.
 * Las firmas reales estan documentadas en `docs/qvac-findings.md`.
 */

export * from './types.js';
export { QvacProvider } from './provider.js';
export {
  watchInferenceJobs,
  type InferenceJobEvent,
  type InferenceJobMessage,
} from './job-watch.js';
export { QvacConsumer, runDelegatedCompletion } from './consumer.js';
export {
  resolveModel,
  listModels,
  buildModelSource,
  assertToolCapable,
  type ModelEntry,
} from './model-registry.js';
export {
  resolveOllamaModel,
  hasOllamaModel,
  ollamaRoot,
  type OllamaModelFiles,
} from './ollama-models.js';
export {
  MockQvacConsumer,
  MockQvacProvider,
  MOCK_PROVIDER_PUBLIC_KEY,
  defaultChainBehavior,
  mockOutcome,
  mockToolCall,
  resetMockCallIds,
  type MockModelBehavior,
  type MockConsumerOptions,
  type ChainBehaviorIds,
} from './mock.js';
