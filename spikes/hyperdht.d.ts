/**
 * hyperdht no publica tipos. Solo se declara la superficie que usa
 * `spikes/nat-check.ts`; el SDK QVAC lo usa internamente con su propia copia.
 */
declare module 'hyperdht' {
  interface DhtPingResponse {
    from: { host: string; port: number };
    to: { host: string; port: number };
  }

  export default class DHT {
    constructor(opts?: { bootstrap?: Array<{ host: string; port: number }> });
    host: string | null;
    port: number;
    firewalled: boolean;
    bootstrapped: boolean;
    fullyBootstrapped(): Promise<void>;
    ping(
      addr: { host: string; port: number },
      opts?: { retry?: boolean; timeout?: number },
    ): Promise<DhtPingResponse>;
    destroy(): Promise<void>;
  }
}
