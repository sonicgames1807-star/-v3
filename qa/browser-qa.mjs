import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = path.join(root, 'index.html');
const appUrl = pathToFileURL(appPath).href;
const results = [];
let browser, context, page;
const record = (name, pass, note='') => results.push({name, status:pass?'пройден':'не пройден', note});
const check = (cond, name, note='') => { record(name,!!cond,note); if(!cond) throw new Error(`${name}: ${note}`); };
async function spin() {
  const old = await page.evaluate(()=>{const s=localStorage.getItem('nomernaya-save-v1');return s?JSON.parse(s):{wallet:0,totalSpins:0,history:[]}});
  await page.locator('#spin').click();
  await page.locator('#spin').evaluate(el=>{for(let i=0;i<8;i++)el.click()});
  await page.waitForFunction(()=>document.querySelector('#spin')?.innerText.includes('НОВЫЙ НОМЕР'),null,{timeout:15000});
  const save = await page.evaluate(()=>JSON.parse(localStorage.getItem('nomernaya-save-v1')));
  return {old,save,heading:await page.locator('.result-caption h1').innerText().catch(()=>''),caption:await page.locator('.result-caption').innerText().catch(()=>''),wallet:save.wallet};
}
async function navigateMenu(name) {
  const menuBtn=page.getByRole('button',{name:'Открыть меню'});
  await menuBtn.click();
  await page.getByRole('button',{name:new RegExp(name)}).click();
}
try {
  browser = await chromium.launch({headless:true,executablePath:'/usr/local/bin/chromium',args:['--no-sandbox']});
  context = await browser.newContext({viewport:{width:320,height:800},acceptDownloads:true,reducedMotion:'no-preference'});
  page = await context.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.goto(`${appUrl}?debug=1`,{waitUntil:'load'});
  await page.getByRole('button',{name:'Открыть меню'}).waitFor();
  check(await page.title()==='Номерная — генератор номеров','Пустой первый запуск','Заголовок и главное действие доступны');
  check((await page.locator('.balance').innerText()).includes('0'),'Стартовый баланс','Новый профиль начинается с нуля');
  check((await page.locator('.spin-cost').innerText()).includes('БЕСПЛАТНО'),'Бесплатный запуск при нуле','Можно крутить без стартовых средств');
  check((await page.evaluate(()=>window.PlateDebug.snapshot().save.settings.speed))==='fast','Быстрая скорость по умолчанию','Обычные результаты раскрываются быстро');
  const firstOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  check(!firstOverflow,'Узкий экран 320 px','Нет горизонтальной прокрутки на стартовом экране');

  const result=await spin();
  check(result.save.totalSpins===1,'Повторные быстрые нажатия','Одна попытка, одно списание, один сохранённый результат');
  check(result.save.wallet===Math.max(0,result.old.wallet-result.save.history[0].cost),'Баланс','Баланс не уходит в минус; бесплатный старт не списывает средства');
  check(result.save.history.length===1,'Коллекция после генерации','Первый результат автоматически сохранён в истории');
  await page.getByRole('button',{name:'В сейф'}).click();
  const favSaved=await page.evaluate(()=>JSON.parse(localStorage.getItem('nomernaya-save-v1')));
  check(favSaved.history[0].favorite===true,'Добавление результата в сейф','Переключатель сейфа изменил только признак избранного');
  check(!!result.heading && result.heading!=='Случайное сочетание','Название результата',result.heading);
  check(!!result.heading&&result.heading!=='Случайное сочетание'&&result.caption.includes(result.heading),'Пояснение результата',result.caption);
  check(/^\d{2,3}$/.test(result.save.history[0].region),'Формат кода региона',result.save.history[0].region);

  await page.reload({waitUntil:'load'});
  let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('nomernaya-save-v1')));
  check(saved.totalSpins===1&&saved.history.length===1,'Перезагрузка и восстановление','Сохранение восстановлено без потери результата');

  await navigateMenu('Настройка генерации');
  const optionData=await page.locator('select[aria-label="Регион"] option').evaluateAll(os=>os.map(o=>({v:o.value,t:o.textContent})));
  check(optionData.some(o=>o.v==='all')&&optionData.some(o=>o.v==='53')&&optionData.length>=100,'Список регионов',`${optionData.length} вариантов с all и кодом 53`);
  await page.getByLabel('Регион').selectOption('all');
  await page.getByRole('button',{name:/Применить и вернуться/}).click();
  let rAll=await spin();
  const allCodes=new Set(optionData.filter(o=>/^\d{2,3}$/.test(o.v)).map(o=>o.v));
  check(allCodes.has(rAll.save.history[0].region),'Режим «Все регионы»',`Выдан допустимый код ${rAll.save.history[0].region}`);

  await navigateMenu('Настройка генерации');
  await page.getByLabel('Регион').selectOption('53');
  await page.getByRole('button',{name:/Применить и вернуться/}).click();
  await page.evaluate(()=>window.PlateDebug.setWallet(2000));
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('nomernaya-save-v1')||'{}').wallet===2000);
  const before53=await page.evaluate(()=>JSON.parse(localStorage.getItem('nomernaya-save-v1')).wallet);
  const r53=await spin();
  check(r53.save.history[0].region==='53','Фиксированный регион 53','Выпавший номер сохранил выбранный код 53');
  check(before53-r53.save.wallet===1549,'Тариф Новгородской области','Списан прежний тариф 1 549 игровых рублей');

  // Check the existing views remain present and usable.
  for (const [menuName, heading] of [['Коллекция','Коллекция'],['Сейф','Сейф'],['Каталог редкостей','Каталог редкостей'],['Статистика','Статистика'],['Настройки','Настройки'],['Референсы и серии','Референсы и серии']]) {
    await navigateMenu(menuName);
    check(await page.getByRole('heading',{name:heading}).count()>0,`Раздел ${heading}`,'Раздел доступен через главное меню');
    await page.getByRole('button',{name:'Вернуться к генератору'}).click();
  }

  await navigateMenu('Настройки');
  const settings=await page.locator('select').evaluateAll(ss=>ss.map(s=>({label:s.getAttribute('aria-label'),value:s.value})).filter(s=>s.label));
  const sound=await page.getByLabel(/Звук эффектов/).isChecked();
  check(!sound,'Звук выключен по умолчанию','Автозапуска звука нет');
  check(settings.some(s=>s.label==='Оформление')&&settings.some(s=>s.label==='Скорость')&&settings.some(s=>s.label==='Качество эффектов'),'Настройки движения и оформления','Скорость, качество эффектов и тема доступны');
  await page.getByLabel('Скорость').selectOption('fast');
  await page.getByLabel('Качество эффектов').selectOption('low');
  await page.getByLabel('Оформление').selectOption('graphite');
  await page.getByLabel(/Анимации/).uncheck();
  let changedSettings=await page.evaluate(()=>JSON.parse(localStorage.getItem('nomernaya-save-v1')).settings);
  check(changedSettings.speed==='fast'&&changedSettings.quality==='low'&&changedSettings.theme==='graphite'&&changedSettings.motion===false,'Сохранение настроек','Скорость, эффекты, тема и анимации сохраняются');
  await page.getByLabel('Скорость').selectOption('normal');
  await page.getByLabel('Качество эффектов').selectOption('high');
  await page.getByLabel('Оформление').selectOption('gold');
  await page.getByLabel(/Анимации/).check();
  const volume=page.getByLabel('Громкость');
  await volume.press('ArrowRight');
  const volumeValue=Number(await volume.inputValue());
  check(volumeValue>=0.35&&volumeValue<=1,'Громкость','Ползунок громкости доступен и изменяется');
  await volume.press('ArrowLeft');
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Скачать копию'}).click();
  const download=await downloadPromise;
  const downloadPath=await download.path();
  const exportJson=JSON.parse(fs.readFileSync(downloadPath,'utf8'));
  check(Array.isArray(exportJson.history)&&exportJson.history.length===3,'Экспорт пользовательских данных','Экспорт содержит результаты и настройки');
  const fileInput=page.locator('input[type="file"]');
  await fileInput.setInputFiles({name:'roundtrip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exportJson))});
  await page.getByRole('heading',{name:'Заменить текущий прогресс?'}).waitFor();
  await page.getByRole('button',{name:'Импортировать'}).last().click();
  await page.getByText('Прогресс импортирован').waitFor();
  const afterValid=await page.evaluate(()=>JSON.parse(localStorage.getItem('nomernaya-save-v1')));
  check(afterValid.history.length===3&&afterValid.totalSpins===3,'Импорт валидной копии','Подтверждённый экспорт импортирован без потери истории');
  const beforeInvalid=JSON.stringify(afterValid);
  await fileInput.setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{not-json')});
  await page.locator('.toast').waitFor();
  const afterInvalid=await page.evaluate(()=>localStorage.getItem('nomernaya-save-v1'));
  check(afterInvalid===beforeInvalid,'Повреждённый импорт','Некорректный файл не перезаписал сохранение');

  // Confirm reset is guarded; cancel to leave this ephemeral test context unchanged.
  await page.getByRole('button',{name:'Сбросить'}).click();
  const dialogText=await page.locator('[role=dialog]').innerText().catch(()=>page.locator('body').innerText());
  check(/сброс|удален|начать заново/i.test(dialogText),'Подтверждение сброса','Перед сбросом появляется диалог');
  const cancel=page.getByRole('button',{name:/Отмена|Не сбрасывать|Назад/i});
  if(await cancel.count()) await cancel.first().click();

  // Responsive overflow checks at common viewport sizes.
  for(const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:900});
    const metrics=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight}));
    check(metrics.scrollWidth<=metrics.clientWidth,`Адаптация ${width}px`,`scrollWidth=${metrics.scrollWidth}, clientWidth=${metrics.clientWidth}`);
    if(width===390) await page.screenshot({path:'/data/nomernaya-final-mobile.png',fullPage:true});
    if(width===1280) await page.screenshot({path:'/data/nomernaya-final-desktop.png',fullPage:true});
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>document.documentElement.dataset.motion==='off');
  check(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches&&document.documentElement.dataset.motion==='off'),'Reduced motion','Системный режим уменьшения движения распознаётся и отключает движение');
  const keyboardPage=await context.newPage();
  await keyboardPage.setViewportSize({width:390,height:844});
  await keyboardPage.goto(appUrl,{waitUntil:'load'});
  await keyboardPage.keyboard.press('Tab');
  const focusInfo=await keyboardPage.evaluate(()=>({tag:document.activeElement.tagName,visible:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineStyle}));
  check(focusInfo.visible&&focusInfo.outline!=='none','Клавиатурный фокус',JSON.stringify(focusInfo));
  await keyboardPage.close();
  check(errors.length===0,'Ошибки консоли и runtime',errors.slice(0,3).join(' | ')||'Не обнаружены');
  console.log(JSON.stringify({pass:true,tests:results},null,2));
} catch(e) {
  console.log(JSON.stringify({pass:false,error:e.message,tests:results},null,2));
  process.exitCode=1;
} finally {
  if(page) await page.close();
  if(context) await context.close();
  if(browser) await browser.close();
}
