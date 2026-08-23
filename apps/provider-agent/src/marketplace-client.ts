/**
 * Cliente del Marketplace API para el Provider Agent.
 *
 * Doc 01 §24: debe poder desactivarse con MARKETPLACE_DISABLED=true; en ese
 * modo imprime lo que habria enviado y no hace fallar nada (PA-009).
 *
 * Doc 01 §12: si la API no esta disponible, QVAC sigue arriba y se reintenta
 * el registro. No hay circuit breakers: backoff simple es suficiente (PA-005).
 */

import type { Logger } from '@meshcompute/config';
import {
  ProviderRegisterRequestSchema,
  type ProviderRegisterRequest,
} from '@meshcompute/contracts';

export interface RegistrationResult {
  providerId: string;
  providerToken: string;
}

export interface MarketplaceClient {
  register(request: ProviderRegisterRequest): Promise<RegistrationResult>;
  heartbeat(providerId: string, providerToken: string): Promise<void>;
}

export class MarketplaceHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MarketplaceHttpError';
  }
}

export class HttpMarketplaceClient implements MarketplaceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly logger: Logger,
  ) {}

  async register(request: ProviderRegisterRequest): Promise<RegistrationResult> {
    // Se valida en origen: si el DTO no cumple el contrato, es un bug nuestro
    // y es mejor verlo aqui que como un 400 opaco de B.
    const payload = ProviderRegisterRequestSchema.parse(request);

    const response = await fetch(`${this.baseUrl}/v1/providers/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new MarketplaceHttpError(
        response.status,
        `register failed: HTTP ${response.status} ${await safeText(response)}`,
      );
    }

    const body = (await response.json()) as {
      id?: unknown;
      providerId?: unknown;
      provider?: { id?: unknown };
      providerToken?: unknown;
      token?: unknown;
    };
    const providerId = body.provider?.id ?? body.id ?? body.providerId;
    const providerToken = body.providerToken ?? body.token;

    if (typeof providerId !== 'string' || typeof providerToken !== 'string') {
      throw new MarketplaceHttpError(
        response.status,
        'register response missing providerId/providerToken',
      );
    }

    return { providerId, providerToken };
  }

  async heartbeat(providerId: string, providerToken: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/v1/providers/${encodeURIComponent(providerId)}/heartbeat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${providerToken}`,
        },
        // Fastify rechaza content-type json con body vacio (400).
        body: JSON.stringify({}),
      },
    );

    if (!response.ok) {
      throw new MarketplaceHttpError(
        response.status,
        `heartbeat failed: HTTP ${response.status}`,
      );
    }
  }
}

/**
 * Modo MARKETPLACE_DISABLED. Imprime el payload que se habria enviado para
 * poder entregarselo a B durante la integracion (doc 01 §34).
 */
export class DisabledMarketplaceClient implements MarketplaceClient {
  constructor(private readonly logger: Logger) {}

  async register(request: ProviderRegisterRequest): Promise<RegistrationResult> {
    this.logger.info({
      event: 'marketplace_disabled_register',
      payload: ProviderRegisterRequestSchema.parse(request),
    });
    return { providerId: 'local-provider', providerToken: 'local-token' };
  }

  async heartbeat(providerId: string): Promise<void> {
    this.logger.debug({ event: 'marketplace_disabled_heartbeat', providerId });
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return '';
  }
}
