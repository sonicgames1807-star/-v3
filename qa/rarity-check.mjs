#!/usr/bin/env node
// Runs the production rarity/generation functions inside a temporary Chromium copy.
// The app itself receives no test UI, no persistent QA mode, and no modified data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'index.html');
const html = fs.readFileSync(sourcePath, 'utf8');
const scriptPattern = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/i;
const match = html.match(scriptPattern);
if (!match) throw new Error('Could not find the inline app script.');
const marker = 'var zl=';
if (match[2].split(marker).length !== 2) throw new Error('Could not locate the generator boundary.');

const sampleSize = Number(process.env.SAMPLE_SIZE || 500000);
if (!Number.isSafeInteger(sampleSize) || sampleSize < 10000 || sampleSize > 5000000) {
  throw new Error('SAMPLE_SIZE must be an integer between 10,000 and 5,000,000.');
}
const probe = `;(()=>{let state=0x5eed1234;const random=()=>{state=(state+0x6D2B79F5)|0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};const n=${sampleSize};const counts=Object.fromEntries(Ie.map(x=>[x.id,0]));const known=new Set(NOM_RU_REGION_CODES);let badFormat=0,badCode=0,emptyReason=0,genericReason=0,fixed53=0,fixedMoscow=0;for(let k=0;k<n;k++){const p=jp("all",random);const v=Lp(p);counts[v.tier]=(counts[v.tier]||0)+1;if(!/^[АВЕКМНОРСТУХ]{3}$/.test(p.letters)||!/^\\d{3}$/.test(p.digits))badFormat++;if(!known.has(p.region))badCode++;if(!Array.isArray(v.reasons)||!v.reasons.length)emptyReason++;if(v.reasons?.[0]==="Случайное сочетание")genericReason++}for(let k=0;k<200;k++){if(jp("53",random).region!=="53")fixed53++;if(!d3.includes(jp("moscow",random).region))fixedMoscow++}const totalWeight=Ie.reduce((s,x)=>s+x.weight,0);const distribution=Ie.map(x=>{const expected=n*x.weight/totalWeight;const observed=counts[x.id]||0;const sigma=Math.sqrt(n*(x.weight/totalWeight)*(1-x.weight/totalWeight));return{id:x.id,weightPct:x.weight,expected,observed,within5Sigma:Math.abs(observed-expected)<=5*sigma+2}});const report={sampleSize:n,sourceWeightsSum:totalWeight,counts,distribution,regionCodes:known.size,badFormat,badCode,emptyReason,genericReason,fixed53Failures:fixed53,fixedMoscowFailures:fixedMoscow,pass:Math.abs(totalWeight-100)<1e-9&&badFormat===0&&badCode===0&&emptyReason===0&&genericReason===0&&fixed53===0&&fixedMoscow===0&&distribution.every(x=>x.within5Sigma)};document.documentElement.setAttribute("data-nomernaya-qa",btoa(JSON.stringify(report)))})();`;
const appScript = match[2].replace(marker, `${probe}${marker}`);
const tempPath = path.join(os.tmpdir(), `nomernaya-qa-${process.pid}.html`);
const tempHtml = html.slice(0, match.index) + match[1] + appScript + match[3] + html.slice(match.index + match[0].length);
fs.writeFileSync(tempPath, tempHtml);
try {
  const browser = process.env.CHROMIUM || 'chromium';
  const run = spawnSync(browser, ['--headless', '--no-sandbox', '--disable-gpu', '--dump-dom', '--virtual-time-budget=15000', pathToFileURL(tempPath).href], { encoding: 'utf8', timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`Chromium exited ${run.status}: ${run.stderr.slice(-2000)}`);
  const encoded = run.stdout.match(/data-nomernaya-qa="([A-Za-z0-9+/=]+)"/);
  if (!encoded) throw new Error(`QA result not found in Chromium output. ${run.stderr.slice(-1000)}`);
  const report = JSON.parse(Buffer.from(encoded[1], 'base64').toString('utf8'));
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} finally {
  fs.rmSync(tempPath, { force: true });
}
