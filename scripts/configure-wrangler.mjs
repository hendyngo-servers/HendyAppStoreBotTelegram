import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const d1 = String(process.env.CLOUDFLARE_D1_DATABASE_ID || '').trim();
const kv = String(process.env.CLOUDFLARE_DEDUPE_KV_NAMESPACE_ID || '').trim();
if (!/^[a-f0-9-]{32,36}$/i.test(d1)) {
  console.error('Set the GitHub Actions variable CLOUDFLARE_D1_DATABASE_ID to the existing D1 UUID.');
  process.exit(1);
}
if (!/^[a-f0-9]{32}$/i.test(kv)) {
  console.error('Set the GitHub Actions variable CLOUDFLARE_DEDUPE_KV_NAMESPACE_ID to the self-healing KV namespace ID.');
  process.exit(1);
}

const workerRoot = path.join(root, 'workers');
const entries = await readdir(workerRoot, { withFileTypes: true });
let updated = 0;
for (const entry of entries.filter((item) => item.isDirectory())) {
  const file = path.join(workerRoot, entry.name, 'wrangler.toml');
  let contents;
  try { contents = await readFile(file, 'utf8'); } catch { continue; }
  const next = contents
    .replaceAll('REPLACE_WITH_D1_DATABASE_ID', d1)
    .replaceAll('REPLACE_WITH_DEDUPE_KV_NAMESPACE_ID', kv);
  if (next.includes('REPLACE_WITH_')) throw new Error(`Unresolved Cloudflare placeholder in ${path.relative(root, file)}`);
  if (next !== contents) { await writeFile(file, next); updated += 1; }
}
console.log(`Configured Cloudflare identifiers in ${updated} Wrangler files for this CI run.`);
