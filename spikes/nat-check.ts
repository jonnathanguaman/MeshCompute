/**
 * Diagnóstico de conectividad P2P entre las dos máquinas de la demo.
 *
 * El error `PEER_CONNECTION_FAILED` significa: el provider SÍ está anunciado
 * en la DHT pero el holepunch NAT falló. Este spike dice en cuál de los dos
 * escenarios estamos, sin adivinar:
 *
 *   PASO 1 — en CADA máquina:
 *     pnpm nat:check
 *   Imprime la IP pública que la DHT observa, el puerto y si está firewalled.
 *
 *   PASO 2 — interpretar:
 *     - MISMA IP pública en ambas => misma red. El SDK usa un atajo LAN
 *       (ping directo a la IP local del provider). Si aún así falla, el
 *       router bloquea tráfico entre clientes (AP/client isolation).
 *       Verificar con: ping <ip-local-de-la-otra-maquina>.
 *       Fix: desactivar el aislamiento en el router, o hotspot del teléfono.
 *     - IPs DISTINTAS y firewalled:true en ambas => casi seguro CGNAT del
 *       ISP en al menos un lado; el holepunch doble-NAT no es viable.
 *       Fix demo: poner ambas máquinas en la misma red (hotspot) o
 *       configurar un blind relay (swarmRelays en qvac.config.json).
 *
 *   PASO 3 (opcional) — probar alcance directo desde la otra máquina:
 *     pnpm nat:check --ping <host:puerto>       (host:puerto del PASO 1)
 */
import DHT from 'hyperdht';
import os from 'node:os';

const argv = process.argv.slice(2);
const pingIndex = argv.indexOf('--ping');
const pingTarget = pingIndex >= 0 ? argv[pingIndex + 1] : undefined;

function localIPv4(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

console.log('bootstrapping DHT...');
const node = new DHT();
await node.fullyBootstrapped();

console.log('\n=== cómo ve la DHT a esta máquina ===');
console.log(`  ip pública : ${node.host ?? '(desconocida)'}`);
console.log(`  puerto     : ${node.port}`);
console.log(`  firewalled : ${node.firewalled ? 'SÍ (NAT sin entrada directa)' : 'NO (alcanzable)'}`);
console.log(`  ips locales: ${localIPv4().join(', ') || '(ninguna)'}`);

if (pingTarget) {
  const [host, portRaw] = pingTarget.split(':');
  const port = Number(portRaw);
  if (!host || !Number.isInteger(port) || port <= 0) {
    console.error(`\n--ping espera host:puerto, recibido: "${pingTarget}"`);
    process.exit(2);
  }
  console.log(`\n=== ping DHT directo a ${host}:${port} ===`);
  try {
    const t0 = Date.now();
    const res = await node.ping({ host, port }, { timeout: 5000 });
    console.log(`  OK en ${Date.now() - t0} ms (respondió ${res.from.host}:${res.from.port})`);
    console.log('  => hay camino UDP directo; el holepunch debería funcionar.');
  } catch (error) {
    console.log(`  FALLO: ${error instanceof Error ? error.message : String(error)}`);
    console.log('  => no hay camino UDP directo a esa dirección desde aquí.');
  }
}

await node.destroy();
process.exit(0);
