// Post-processes the raw css-vars export from figma-console-mcp into usable CSS.
// Run:  node design-system/postprocess-tokens.mjs
// See design-system/README.md for the full regeneration workflow.
//
// The raw export needs four fixes:
//   1. Single-mode collections come out under [data-theme="mode"] / "mode-1" — never matches.
//   2. The Dark mode block comes out as .dark — we want [data-theme="dark"] too.
//   3. Figma floats serialize as 0.1599999964237213.
//   4. Font weights are Figma style NAMES ("SemiBold"), not CSS numbers.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const RAW = join(dir, 'tokens.raw.css');
const OUT = join(dir, 'tokens.css');

let css = readFileSync(RAW, 'utf8');

// 1 + 2 — normalize selectors
css = css.replace(/^\[data-theme="mode(-1)?"\] \{/gm, ':root {');
// Unscoped so any subtree can be themed, not just <html>.
css = css.replace(/^\.dark \{/gm, '[data-theme="dark"],\n.dark {');

// 3 — round Figma float noise
css = css.replace(/(-?\d+\.\d{5,})/g, (m) => String(Number(parseFloat(m).toFixed(4))));

// 4b — EXPORTER BUG CORRECTIONS.
// When a variable's alias target changes in Figma, figma_export_tokens keeps
// emitting the OLD target. Re-exporting doesn't clear it and neither does
// figma_get_variables({refreshCache:true}) — but the Plugin API reports the new
// value correctly, so the mismatch is in the exporter, not the file.
// Each entry is [token, correct alias, what Figma actually resolves to].
// Verify with the Plugin API before adding one; delete an entry once the export
// agrees (the build tells you when that happens).
// Empty as of the 2026-08-13 re-export — the six label/sm/* corrections that
// used to live here now come through correctly from Figma.
const CORRECTIONS = [];

// Resolve what the raw export currently produces, so we can report which
// corrections are still doing work and which have become redundant.
const rawVars = new Map();
for (const [, sel, body] of css.matchAll(/^([^{@\s][^{]*)\{([\s\S]*?)^\}/gm)) {
  if (/dark/.test(sel)) continue;
  for (const [, n, v] of body.matchAll(/^\s*(--pl-[\w-]+):\s*([^;]+);/gm)) rawVars.set(n, v.trim());
}
const deref = (v, d = 0) => {
  const m = d < 12 && String(v).match(/^var\((--pl-[\w-]+)\)$/);
  return m && rawVars.has(m[1]) ? deref(rawVars.get(m[1]), d + 1) : v;
};
const stillNeeded = CORRECTIONS.filter(([name, , expect]) => deref(rawVars.get(name)) !== expect);
const redundant = CORRECTIONS.filter(([name, , expect]) => deref(rawVars.get(name)) === expect);
if (redundant.length) {
  console.log(`NOTE: ${redundant.length} correction(s) now match the export and can be deleted:`);
  redundant.forEach(([n]) => console.log(`  ${n}`));
}
if (stillNeeded.length) console.log(`Applied ${stillNeeded.length} exporter correction(s).`);

// 4 + derived tokens
const SHADOWS = ['xs', 'sm', 'md', 'lg', 'xl', 'overlay', 'modal'];
const derived = `
/* ---------------------------------------------------------------------------
   Derived tokens — added by postprocess-tokens.mjs, not present in Figma.
   These override or compose the generated values above so they are usable
   directly in CSS. Later :root wins, so ordering matters — keep this last.
   --------------------------------------------------------------------------- */
:root {
  /* Figma stores weights as style names; CSS needs numbers. */
  --pl-type-weight-regular: 400;
  --pl-type-weight-medium: 500;
  --pl-type-weight-semibold: 600;
  --pl-type-weight-bold: 700;
  --pl-type-weight-extrabold: 800;
  --pl-type-weight-black: 900;

  /* Font families get a real fallback stack. */
  --pl-type-font-primary: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --pl-type-font-brand: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Shadow color as channels, so opacity tokens can drive rgb(). */
  --pl-shadow-rgb: 2 2 3;

  /* Corrections for figma_export_tokens emitting stale alias targets — see
     CORRECTIONS in postprocess-tokens.mjs. These are the values the Figma
     Plugin API reports, which is the authority. */
${CORRECTIONS.map(([name, value]) => `  ${name}: ${value};`).join('\n')}

${SHADOWS.map(
  (s) =>
    `  --pl-elevation-${s}: var(--pl-shadow-${s}-x) var(--pl-shadow-${s}-y) var(--pl-shadow-${s}-blur) var(--pl-shadow-${s}-spread) rgb(var(--pl-shadow-rgb) / var(--pl-shadow-${s}-opacity));`
).join('\n')}
}
`;

const final = css.trimEnd() + '\n' + derived;
writeFileSync(OUT, final);
console.log(`Wrote ${OUT}`);

// --- Emit tokens.js so index.html can render a reference page without fetch()
// (file:// blocks both fetch and cssRules access on linked stylesheets).
// Match any top-level selector block, not just :root — the dark block is
// [data-theme="dark"], .dark and would otherwise be skipped entirely.
const blocks = [...final.matchAll(/^([^{@\s][^{]*)\{([\s\S]*?)^\}/gm)];
const light = [];
const dark = new Set();
for (const [, sel, body] of blocks) {
  const isDark = /dark/.test(sel);
  for (const [, name, value] of body.matchAll(/^\s*(--pl-[\w-]+):\s*([^;]+);/gm)) {
    if (isDark) dark.add(name);
    else if (!light.some((t) => t.name === name)) light.push({ name, value: value.trim() });
    else light[light.findIndex((t) => t.name === name)].value = value.trim();
  }
}
const tokensJs = `// Generated by postprocess-tokens.mjs — do not edit by hand.
window.PL_TOKENS = ${JSON.stringify(light, null, 2)};
window.PL_THEMED = ${JSON.stringify([...dark], null, 2)};
`;
writeFileSync(join(dir, 'tokens.js'), tokensJs);
console.log(`Wrote tokens.js (${light.length} tokens, ${dark.size} themed)`);
