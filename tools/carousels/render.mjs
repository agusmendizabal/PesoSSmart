#!/usr/bin/env node
/**
 * Renderiza los carruseles de carousels.json a PNG de 1080x1350.
 *
 *   npm install && npx playwright install chromium   # una sola vez
 *   node render.mjs                                  # todos
 *   node render.mjs --only dia-01                    # uno solo
 *   node render.mjs --out ../../out                  # otra carpeta de salida
 */

import { mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { slideHTML, AESTHETIC_NAMES, W, H } from './template.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGES = 4; // páginas en paralelo dentro del mismo navegador

async function loadPlaywright() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    throw new Error(
      'Falta Playwright. Corré, dentro de tools/carousels:\n' +
        '  npm install\n' +
        '  npx playwright install chromium'
    );
  }
}

/* ---------- fuentes ---------- */

/**
 * Si hay .ttf/.otf/.woff2 en ./fonts se empotran como data URI y el render queda
 * igual en cualquier máquina y sin internet. Si no, se cae a Google Fonts.
 * El peso sale del número en el nombre del archivo: Montserrat-800.ttf
 */
async function loadFonts() {
  const dir = join(HERE, 'fonts');
  if (!existsSync(dir)) return [];
  const fonts = [];
  for (const f of await readdir(dir)) {
    if (!/\.(ttf|otf|woff2)$/i.test(f)) continue;
    const weight = (f.match(/(\d{3})/) || [])[1];
    if (!weight) continue;
    const ext = f.split('.').pop().toLowerCase();
    fonts.push({
      weight,
      format: ext === 'otf' ? 'opentype' : ext,
      data: (await readFile(join(dir, f))).toString('base64'),
    });
  }
  return fonts;
}

/* ---------- validación ---------- */

/**
 * Regla 3 del brief: todo dato en pantalla lleva su fuente. La regla vive acá,
 * no en la memoria de quien escribe el carrusel: sin fuente no se renderiza.
 */
function validate(carousels) {
  const errors = [];
  const slugs = new Set();

  for (const c of carousels) {
    if (!c.slug) errors.push('Hay un carrusel sin slug.');
    if (slugs.has(c.slug)) errors.push(`Slug repetido: ${c.slug}`);
    slugs.add(c.slug);

    if (!AESTHETIC_NAMES.includes(c.aesthetic)) {
      errors.push(`${c.slug}: estética "${c.aesthetic}" no existe (hay ${AESTHETIC_NAMES.join(', ')}).`);
    }
    if (!Array.isArray(c.slides) || c.slides.length < 3) {
      errors.push(`${c.slug}: necesita al menos 3 slides.`);
    } else if (c.slides.length > 10) {
      errors.push(`${c.slug}: tiene ${c.slides.length} slides. El rango usable es 5-10.`);
    }

    (c.slides || []).forEach((s, i) => {
      if (s.type === 'stat' && !s.source) {
        errors.push(`${c.slug} slide ${i + 1}: hay una cifra en pantalla sin fuente.`);
      }
      if (s.type === 'close' && !s.cta) {
        errors.push(`${c.slug} slide ${i + 1}: el cierre necesita CTA.`);
      }
    });
  }
  return errors;
}

/* ---------- render ---------- */

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const outRoot = resolve(HERE, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'out');

  const all = JSON.parse(await readFile(join(HERE, 'carousels.json'), 'utf8'));
  const carousels = only ? all.filter((c) => c.slug === only) : all;

  if (!carousels.length) {
    console.error(only ? `No hay ningún carrusel con slug "${only}".` : 'carousels.json está vacío.');
    process.exit(1);
  }

  const errors = validate(carousels);
  if (errors.length) {
    console.error('\nNo se renderizó nada. Corregí esto primero:\n');
    for (const e of errors) console.error('  · ' + e);
    console.error('');
    process.exit(1);
  }

  const chromium = await loadPlaywright();
  const fonts = await loadFonts();
  if (!fonts.length) {
    console.log('Montserrat no está en ./fonts: se usa Google Fonts, así que hace falta internet.');
  }

  const jobs = [];
  for (const c of carousels) {
    for (let i = 0; i < c.slides.length; i++) {
      jobs.push({ carousel: c, slide: c.slides[i], index: i, total: c.slides.length });
    }
  }

  const started = Date.now();
  const browser = await chromium.launch();
  let done = 0;

  try {
    const queue = [...jobs];
    const workers = Array.from({ length: Math.min(PAGES, queue.length) }, async () => {
      const page = await browser.newPage({
        viewport: { width: W, height: H },
        deviceScaleFactor: 1,
      });
      try {
        while (queue.length) {
          const { carousel, slide, index, total } = queue.shift();
          const dir = join(outRoot, carousel.slug);
          await mkdir(dir, { recursive: true });

          await page.setContent(slideHTML({ carousel, slide, index, total, fonts }), {
            waitUntil: 'load',
          });
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({
            path: join(dir, `${String(index + 1).padStart(2, '0')}.png`),
          });

          done++;
          process.stdout.write(`\r  ${done}/${jobs.length} slides`);
        }
      } finally {
        await page.close();
      }
    });
    await Promise.all(workers);
  } finally {
    await browser.close();
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n\nListo: ${carousels.length} carruseles, ${jobs.length} slides en ${secs}s`);
  console.log(`Salida: ${outRoot}\n`);
  for (const c of carousels) {
    console.log(`  ${c.slug}  ${String(c.slides.length).padStart(2)} slides  ${c.aesthetic.padEnd(12)} ${c.title}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('\n' + err.message + '\n');
  process.exit(1);
});
