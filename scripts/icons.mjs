import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const icons = new URL('../icons/', import.meta.url);
const source = readFileSync(new URL('icon.svg', icons), 'utf8');

const renders = [
  { file: 'icon-192.png', size: 192, shape: 'rounded' },
  { file: 'icon-512.png', size: 512, shape: 'rounded' },
  { file: 'icon-maskable-192.png', size: 192, shape: 'full-bleed' },
  { file: 'icon-maskable-512.png', size: 512, shape: 'full-bleed' },
  { file: 'apple-touch-icon.png', size: 180, shape: 'full-bleed' },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const render of renders) await renderIcon(page, render);
await browser.close();
console.log(`Rendered ${renders.length} icons from icons/icon.svg`);

async function renderIcon(page, { file, size, shape }) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(iconPage(size, shape));
  await page.screenshot({ path: new URL(file, icons).pathname, omitBackground: true });
}

function iconPage(size, shape) {
  const radius = shape === 'rounded' ? size * 0.22 : 0;
  return `<!doctype html>
    <style>
      html, body { margin: 0; background: transparent; }
      div { width: ${size}px; height: ${size}px; border-radius: ${radius}px; overflow: hidden; }
      svg { display: block; width: 100%; height: 100%; }
    </style>
    <div>${source}</div>`;
}
