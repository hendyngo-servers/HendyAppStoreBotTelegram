#!/usr/bin/env node
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
const [rawName, target='api'] = process.argv.slice(2);
if (!rawName || !/^[a-z][a-z0-9-]{1,39}$/.test(rawName)) { console.error('Usage: pnpm generate:module <name> [api|bot|component]'); process.exit(2); }
if (!['api','bot','component'].includes(target)) { console.error('target must be api, bot, or component'); process.exit(2); }
const root=process.cwd(); const pascal=rawName.split('-').map(part=>part[0].toUpperCase()+part.slice(1)).join('');
const targetPath=target==='api'?`workers/platform-api/src/routes/${rawName}.ts`:target==='bot'?`workers/telegram-bot/src/modules/${rawName}-module.ts`:`apps/mini-app/src/components/${pascal}.tsx`;
const templatePath=path.join(root,'scripts/scaffold/templates',target==='component'?'component.hbs':'route.hbs');
let content=await readFile(templatePath,'utf8');content=content.replaceAll('{{pascalName}}',pascal).replaceAll('{{name}}',rawName);
if(target==='bot') content=`export async function handle${pascal}Command(message: { text?: string; from?: { id: number } }) {\n  return { handled: Boolean(message.text?.startsWith('/${rawName}')), message: '${pascal} module scaffold' };\n}\n`;
const out=path.join(root,targetPath);await mkdir(path.dirname(out),{recursive:true});try{await access(out);console.error(`Refusing to overwrite existing file: ${targetPath}`);process.exit(3);}catch{}
await writeFile(out,content);console.log(`Generated ${targetPath}`);
