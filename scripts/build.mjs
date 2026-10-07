// Builds the website: readable sources in web/ → compact files in public/ (no comments, minified).
// Run after editing anything in web/:  npm run build
import { transform } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const src = new URL('../web/', import.meta.url), out = new URL('../public/', import.meta.url);
for (const f of readdirSync(src)) {
  const code = readFileSync(new URL(f, src), 'utf8');
  let res = code;
  if (f.endsWith('.js')) res = (await transform(code, { loader: 'js', minify: true, legalComments: 'none', target: 'es2020' })).code;
  else if (f.endsWith('.css')) res = (await transform(code, { loader: 'css', minify: true, legalComments: 'none' })).code;
  else if (f.endsWith('.html')) {
    res = code.replace(/<!--[\s\S]*?-->/g, '').replace(/\n\s+/g, '\n').replace(/\n{2,}/g, '\n');
    res = await replaceAsync(res, /<style>([\s\S]*?)<\/style>/g, async (m, css) => '<style>' + (await transform(css, { loader: 'css', minify: true })).code.trim() + '</style>');
  }
  writeFileSync(new URL(f, out), res);
  console.log(f.padEnd(16), code.length, '→', res.length);
}
async function replaceAsync(s, re, fn) { const parts = []; s.replace(re, (...a) => { parts.push(fn(...a)); return ''; }); const r = await Promise.all(parts); let i = 0; return s.replace(re, () => r[i++]); }
