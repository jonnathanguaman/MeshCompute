import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('OpenAPI handoff', () => {
  it('is valid YAML and documents every marketplace endpoint', () => {
    const path = fileURLToPath(new URL('../../../docs/openapi.yaml', import.meta.url));
    const specification = parse(readFileSync(path, 'utf8')) as {
      openapi: string;
      paths: Record<string, unknown>;
    };

    expect(specification.openapi).toBe('3.1.0');
    expect(Object.keys(specification.paths).sort()).toEqual(
      [
        '/health',
        '/v1/auth/login',
        '/v1/auth/logout',
        '/v1/auth/me',
        '/v1/auth/register',
        '/v1/jobs',
        '/v1/jobs/{id}',
        '/v1/jobs/{id}/progress',
        '/v1/jobs/{id}/settle',
        '/v1/portal/client/contracts',
        '/v1/portal/contracts',
        '/v1/portal/contracts/{id}/accept',
        '/v1/portal/contracts/{id}/cancel',
        '/v1/portal/contracts/{id}/reject',
        '/v1/portal/provider/contracts',
        '/v1/portal/provider/listings',
        '/v1/portal/provider/listings/{id}',
        '/v1/portal/wallet',
        '/v1/providers',
        '/v1/providers/register',
        '/v1/providers/{id}',
        '/v1/providers/{id}/heartbeat',
        '/v1/stats',
      ].sort(),
    );
    expect(readFileSync(path, 'utf8')).not.toMatch(/^\s+(prompt|response|rawOutput):/m);
  });
});
