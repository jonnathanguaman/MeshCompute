import { listModels, resolveOllamaModel } from '@meshcompute/qvac-adapter';
import fs from 'node:fs';

for (const m of listModels()) {
  const tools = m.supportsTools ? 'tools:SI ' : 'tools:NO ';
  if (m.source === 'registry') {
    console.log(`  ${m.key.padEnd(20)} ${tools} registry  ${m.label}`);
    continue;
  }
  try {
    const f = resolveOllamaModel(m.ollamaRef!);
    const ok = fs.existsSync(f.modelPath);
    console.log(
      `  ${m.key.padEnd(20)} ${tools} ollama    ${m.label}\n` +
      `      blob: ${ok ? 'OK' : 'MISSING'}  ${(f.sizeBytes / 1e9).toFixed(2)} GB` +
      (f.projectionPath ? `\n      mmproj: ${f.projectionPath}` : ''),
    );
  } catch (e) {
    console.log(`  ${m.key.padEnd(20)} ${tools} ollama    ERROR: ${(e as Error).message.split('\n')[0]}`);
  }
}
