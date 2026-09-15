import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const out='C:/Users/Ashley/Resonance/OpenNova/apps/epublisher-sovereign-local-v0.1/docs/generated';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1500},acceptDownloads:true});
const log=[]; const snap=async(name)=>{const text=await page.locator('body').innerText(); log.push(`\n## ${name}\n${text}`); await page.screenshot({path:`${out}/${name}.png`,fullPage:true});};
await page.goto('http://127.0.0.1:3101/app',{waitUntil:'networkidle',timeout:30000});
await page.locator('textarea').first().fill('The History of Cape Coloured People');
await page.getByRole('button',{name:'Research',exact:true}).click();
await page.waitForFunction(()=>document.body.innerText.includes('Discovery complete'),null,{timeout:60000});
await snap('acceptance-01-review');
for(const title of ['Coloureds','Cape Malays','Hanover Park, Cape Town']){
  const card=page.locator('div.rounded-lg.border').filter({hasText:title}).first();
  await card.getByRole('checkbox').click();
}
await snap('acceptance-02-selection');
const extract=page.getByRole('button',{name:/Extract content from .* selected source/});
await extract.click();
await page.waitForFunction(()=>document.body.innerText.includes('Extraction complete'),null,{timeout:90000});
await snap('acceptance-03-extraction');const approve=page.getByRole('button',{name:'Approve short extract for generation'});
while(await approve.count()) await approve.first().click();
await snap('acceptance-04-short-reviewed');
await page.getByRole('button',{name:/Configure Story|Configure story|Configure/i}).last().click();
await page.waitForTimeout(500);
await snap('acceptance-05-configure');
console.log((await page.getByRole('button').allTextContents()).join('\n'));
await writeFile(`${out}/CAPE_COLOURED_ACCEPTANCE_UI_LOG_20260912.txt`,log.join('\n'),'utf8');
await browser.close();