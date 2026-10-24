import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = pathToFileURL(path.join(root, 'index.html')).href;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM || '/usr/local/bin/chromium',
  args: ['--no-sandbox'],
});
const results = [];
const check = (ok, name, details = '') => {
  results.push({ name, status: ok ? 'passed' : 'failed', details });
  if (!ok) throw new Error(`${name}: ${details}`);
};

try {
  // New profile: zero balance, fast default and an affordable (free) first spin.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${appUrl}?debug=1`, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Открыть меню' }).waitFor();
  await page.waitForFunction(() => !!window.PlateDebug);
  const fresh = await page.evaluate(() => window.PlateDebug.snapshot().save);
  check(fresh.wallet === 0, 'New profile starts at zero', String(fresh.wallet));
  check(fresh.settings.speed === 'fast', 'Fast spin is the default', fresh.settings.speed);
  check((await page.locator('.spin-cost').innerText()).includes('БЕСПЛАТНО'), 'Zero-balance spin is labelled free', await page.locator('.spin-cost').innerText());
  await page.locator('#spin').click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('nomernaya-save-v1');
    return raw && JSON.parse(raw).totalSpins === 1 && document.querySelector('.game-scene')?.classList.contains('phase-idle');
  }, null, { timeout: 12000 });
  const afterFree = await page.evaluate(() => JSON.parse(localStorage.getItem('nomernaya-save-v1')));
  check(afterFree.wallet === 0 && afterFree.history[0].cost === 0, 'Free spin does not debit or create negative balance', JSON.stringify({ wallet: afterFree.wallet, cost: afterFree.history[0].cost }));
  await context.close();

  // Migrate only a pristine old default save; never reset user progress.
  const migrationContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const migrationPage = await migrationContext.newPage();
  await migrationPage.addInitScript(() => {
    localStorage.setItem('nomernaya-save-v1', JSON.stringify({
      version: 1, revision: 0, wallet: 25000000, history: [],
      settings: { sound: false, volume: .35, motion: true, quality: 'high', speed: 'normal', region: 'moscow', theme: 'gold' },
      totalSpins: 0, totalValue: 0,
      tierCounts: { common: 0, unusual: 0, rare: 0, epic: 0, legendary: 0 }, lastResult: null,
    }));
  });
  await migrationPage.goto(appUrl, { waitUntil: 'load' });
  const migrated = await migrationPage.evaluate(() => JSON.parse(localStorage.getItem('nomernaya-save-v1')));
  check(migrated.wallet === 0 && migrated.revision === 1 && migrated.totalSpins === 0, 'Pristine legacy default is safely migrated', JSON.stringify({ wallet: migrated.wallet, revision: migrated.revision }));
  check(migrated.settings.speed === 'fast', 'Pristine legacy profile gets fast default', migrated.settings.speed);
  await migrationContext.close();

  // Existing progress is preserved even if it used the former start balance.
  const progressContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const progressPage = await progressContext.newPage();
  await progressPage.addInitScript(() => {
    localStorage.setItem('nomernaya-save-v1', JSON.stringify({
      version: 1, revision: 2, wallet: 24986875, history: [],
      settings: { sound: false, volume: .35, motion: true, quality: 'high', speed: 'normal', region: 'moscow', theme: 'gold' },
      totalSpins: 0, totalValue: 0,
      tierCounts: { common: 0, unusual: 0, rare: 0, epic: 0, legendary: 0 }, lastResult: null,
    }));
  });
  await progressPage.goto(appUrl, { waitUntil: 'load' });
  const preserved = await progressPage.evaluate(() => JSON.parse(localStorage.getItem('nomernaya-save-v1')));
  check(preserved.wallet === 24986875 && preserved.revision === 2, 'Progressed legacy balance is preserved', String(preserved.wallet));
  await progressContext.close();

  // Force a known valuable result through the isolated debug hook and verify the reveal remains smooth.
  const jackpotContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const jackpotPage = await jackpotContext.newPage();
  await jackpotPage.goto(`${appUrl}?debug=1`, { waitUntil: 'load' });
  await jackpotPage.evaluate(() => window.PlateDebug.force('А777МР777'));
  await jackpotPage.waitForFunction(() => document.querySelector('.game-scene')?.classList.contains('high-value') && document.querySelector('.game-scene')?.classList.contains('phase-revealing'), null, { timeout: 8000 });
  const jackpot = await jackpotPage.evaluate(() => ({
    value: window.PlateDebug.snapshot().current.value,
    animation: getComputedStyle(document.querySelector('.game-scene .value-bar')).animationName,
    phase: window.PlateDebug.snapshot().phase,
  }));
  check(jackpot.value >= 1000000, 'One-million threshold activates for expensive results', String(jackpot.value));
  check(jackpot.animation === 'jackpot-glow' && jackpot.phase === 'revealing', 'Expensive result uses smooth reveal animation', JSON.stringify(jackpot));
  await jackpotPage.waitForTimeout(1000);
  check(await jackpotPage.evaluate(() => window.PlateDebug.snapshot().phase === 'revealing'), 'High-value reveal is not skipped immediately', 'Still revealing after one second');
  await jackpotContext.close();

  console.log(JSON.stringify({ pass: true, checks: results }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ pass: false, error: error.message, checks: results }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
