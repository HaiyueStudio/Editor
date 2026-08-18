import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const budgets = JSON.parse(await readFile(resolve(root, 'config/designer-candidate-budgets.json'), 'utf8'));
const files = await walk(resolve(root, 'dist'));
let javascriptBytes = 0;
let sourceMapBytes = 0;
for (const file of files) {
  const bytes = (await stat(file)).size;
  if (file.endsWith('.js')) javascriptBytes += bytes;
  else if (file.endsWith('.js.map')) sourceMapBytes += bytes;
}
const result = { status: 'candidate', javascriptBytes, sourceMapBytes, fileCount: files.length };
if (javascriptBytes > budgets.bundle.javascriptBytes || sourceMapBytes > budgets.bundle.sourceMapBytes) {
  throw new Error(`G09 candidate bundle budget exceeded: ${JSON.stringify({ result, budget: budgets.bundle })}`);
}
console.log(`[g09-candidate-bundle] ${JSON.stringify(result)}`);

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else result.push(path);
  }
  return result;
}
