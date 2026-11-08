import { writeFileSync, mkdirSync } from 'node:fs';
import { createDemoCatalog } from './demo-catalog.mjs';

const reference = '2026-11-07T17:00:00.000Z';
const catalog = createDemoCatalog(new Date(reference));
mkdirSync('docs/try', { recursive: true });
writeFileSync('docs/try/data.mjs', `// Synthetic scenario for an isolated browser workspace.\nexport const SEED_REFERENCE = ${JSON.stringify(reference)};\nexport const SEED_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`);
console.log('Browser demonstration scenario written.');
