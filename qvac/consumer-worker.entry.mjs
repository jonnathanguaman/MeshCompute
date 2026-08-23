// Consumer-only QVAC worker. It avoids loading every inference plugin on the
// machine that only connects to a remote provider, reducing RAM and startup
// requirements without enabling a local inference fallback.
import {
  ensureRPCSetup,
  initializeWorkerCore,
} from '../node_modules/@qvac/sdk/dist/server/worker-core.js';

const { hasRPCConfig } = initializeWorkerCore();

if (hasRPCConfig) {
  ensureRPCSetup();
}
