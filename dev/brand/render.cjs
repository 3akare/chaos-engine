// Renders dist/brand in headless Chromium and saves each image to assets/brand.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const dir = path.join(__dirname, '../../dist/brand');
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(dir, 'index.html'));
  await page.waitForFunction(() => window.brandImages, null, { timeout: 20000 });
  const images = await page.evaluate(() => window.brandImages);
  const out = path.join(__dirname, '../../assets/brand');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, url] of Object.entries(images)) {
    fs.writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', name);
  }
  if (errors.length) console.log('errors', errors);
  await browser.close();
})();
