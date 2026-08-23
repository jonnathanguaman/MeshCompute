import { getSystemResources } from '@qvac/sdk';
const r = await getSystemResources();
function unwrap(n){ return (n && typeof n==='object' && 'value' in n) ? unwrap(n.value) : n; }
const gpus = unwrap(unwrap(r)?.capabilities?.gpu);
console.log('GPU devices detectados:', Array.isArray(gpus) ? gpus.length : 0);
if (Array.isArray(gpus)) for (const g of gpus) console.log('  -', unwrap(g?.name));
process.exit(0);
