// Generates typography.css — ready-to-use text style classes.
// Run:  node design-system/build-typography.mjs
//
// Two layers come out of this:
//   .pl-text-*  — one class per Typography/Semantic variable style (37)
//   .pl-*       — one class per Figma TEXT STYLE under role/* (29), the layer
//                 designers actually apply. Each is an alias of a .pl-text-* class.
//
// ROLE_STYLES below is transcribed from the Figma file's text styles, including the
// size/lineHeight/weight Figma reports. The build ASSERTS those still match the
// resolved token values, so if the variables drift the build fails instead of
// silently emitting wrong CSS. If a text style is added/changed in Figma, re-dump
// with the figma_get_text_styles MCP tool and update this table.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

// figmaName, cssClass, token style, and what Figma reports [size, lineHeight, weight]
const ROLE_STYLES = [
  ['role/pageTitle',                                  'page-title',                'display-md',       [32, 40, 500]],
  ['role/contentTitle',                               'content-title',             'display-sm',       [24, 28, 500]],
  ['role/sectionHeader',                              'section-header',            'heading-h3',       [20, 28, 500]],
  ['role/cardTitle',                                  'card-title',                'title-lg-medium',  [18, 26, 500]],
  ['role/listTitle',                                  'list-title',                'title-md-medium',  [16, 24, 500]],
  ['role/tabLabel',                                   'tab-label',                 'caption-lg',       [12, 16, 400]],
  ['role/captionPrimary',                             'caption-primary',           'caption-lg',       [12, 16, 400]],
  ['role/captionPrimary medium',                      'caption-primary-medium',    'caption-lg-medium',[12, 16, 500]],
  ['role/captionPrimary bold',                        'caption-primary-bold',      'caption-lg-bold',  [12, 16, 700]],
  ['role/captionSecondary',                           'caption-secondary',         'caption-sm',       [11, 14, 500]],
  ['role/body/large/bodyLarge regular',               'body-large-regular',        'body-lg-regular',  [16, 24, 400]],
  ['role/body/large/bodyLarge medium',                'body-large-medium',         'body-lg-medium',   [16, 24, 500]],
  ['role/body/large/bodyLarge semiBold',              'body-large-semibold',       'body-lg-semibold', [16, 24, 600]],
  ['role/body/medium/bodyMedium regular',             'body-medium-regular',       'body-md-regular',  [14, 20, 400]],
  ['role/body/medium/bodyMedium medium',              'body-medium-medium',        'body-md-medium',   [14, 20, 500]],
  ['role/body/medium/bodyMedium semiBold',            'body-medium-semibold',      'body-md-semibold', [14, 20, 600]],
  ['role/body/small/bodySmall regular',               'body-small-regular',        'body-sm-regular',  [13, 18, 400]],
  ['role/body/small/bodySmall medium',                'body-small-medium',         'body-sm-medium',   [13, 18, 500]],
  ['role/body/small/bodySmall semiBold',              'body-small-semibold',       'body-sm-semibold', [13, 18, 600]],
  ['role/button label/large/buttonLabelLarge medium',    'button-label-large-medium',    'label-lg-medium',   [16, 24, 500]],
  ['role/button label/large/buttonLabelLarge semibold',  'button-label-large-semibold',  'label-lg-semibold', [16, 24, 600]],
  ['role/button label/medium/buttonLabelMedium medium',  'button-label-medium-medium',   'label-md-medium',   [14, 20, 500]],
  ['role/button label/medium/buttonLabelMedium semibold','button-label-medium-semibold', 'label-md-semibold', [14, 20, 600]],
  ['role/button label/small/buttonLabelSmall medium',    'button-label-small-medium',    'label-sm-medium',   [13, 18, 500]],
  ['role/button label/small/buttonLabelSmall semibold',  'button-label-small-semibold',  'label-sm-semibold', [13, 18, 600]],
  ['role/input label/large/inputLabelLarge medium',      'input-label-large-medium',     'label-lg-medium',   [16, 24, 500]],
  ['role/input label/large/inputLabelLarge semiBold',    'input-label-large-semibold',   'label-lg-semibold', [16, 24, 600]],
  ['role/input label/medium/inputLabelMedium medium',    'input-label-medium-medium',    'label-md-medium',   [14, 20, 500]],
  ['role/input label/medium/inputLabelMedium semiBold',  'input-label-medium-semibold',  'label-md-semibold', [14, 20, 600]],
];

// --- Resolve the token styles out of tokens.css
const css = readFileSync(join(dir, 'tokens.css'), 'utf8');
const vars = new Map();
for (const [, sel, body] of css.matchAll(/^([^{]*)\{([\s\S]*?)^\}/gm)) {
  if (/dark/.test(sel)) continue; // light values only — dark doesn't change type
  for (const [, n, v] of body.matchAll(/^\s*(--pl-[\w-]+):\s*([^;]+);/gm)) vars.set(n, v.trim());
}
const deref = (v, d = 0) => {
  const m = d < 12 && String(v).match(/^var\((--pl-[\w-]+)\)$/);
  return m && vars.has(m[1]) ? deref(vars.get(m[1]), d + 1) : v;
};

const tokenStyles = {};
for (const n of vars.keys()) {
  const m = n.match(/^--pl-((?:display|heading|title|body|label|caption)-[\w-]+?)-(font|size|lineheight|weight)$/);
  if (m) (tokenStyles[m[1]] ||= {})[m[2]] = n;
}

// --- Assert the Figma text styles still match the tokens they're mapped to
const errors = [];
for (const [figmaName, , token, [size, lh, weight]] of ROLE_STYLES) {
  const s = tokenStyles[token];
  if (!s) { errors.push(`${figmaName}: token style "${token}" not found in tokens.css`); continue; }
  const got = [deref(vars.get(s.size)), deref(vars.get(s.lineheight)), deref(vars.get(s.weight))];
  const want = [`${size}px`, `${lh}px`, String(weight)];
  if (got.join() !== want.join()) {
    errors.push(`${figmaName} → ${token}: Figma says ${want.join(' / ')}, tokens resolve to ${got.join(' / ')}`);
  }
}
if (errors.length) {
  console.error('Typography mapping is out of date:\n  ' + errors.join('\n  '));
  process.exit(1);
}

// --- Emit
const decl = (style) => {
  const s = tokenStyles[style];
  return [
    `  font-family: var(${s.font ?? '--pl-type-font-primary'});`,
    `  font-size: var(${s.size});`,
    `  line-height: var(${s.lineheight});`,
    `  font-weight: var(${s.weight});`,
  ].join('\n');
};

const styleSizePx = (style) => parseFloat(deref(vars.get(tokenStyles[style].size))) || 0;
const sortedTokenStyles = Object.keys(tokenStyles).sort(
  (a, b) => styleSizePx(b) - styleSizePx(a) || a.localeCompare(b),
);

// group role aliases by the token style they point at, so each rule is written once
const aliases = {};
for (const [, cls, token] of ROLE_STYLES) (aliases[token] ||= []).push(cls);

const out = `/* Generated by build-typography.mjs — do not edit by hand.
   Requires tokens.css to be linked first. */

/* ---------------------------------------------------------------------------
   Token styles — one per Typography/Semantic style in Figma (${sortedTokenStyles.length}).
   Ordered largest → smallest by resolved font-size.
   --------------------------------------------------------------------------- */
${sortedTokenStyles.map((s) => `.pl-text-${s} {\n${decl(s)}\n}`).join('\n\n')}

/* ---------------------------------------------------------------------------
   Role styles — the ${ROLE_STYLES.length} Figma text styles designers apply.
   Each is an alias of the token style above with identical metrics.
   --------------------------------------------------------------------------- */
${Object.entries(aliases)
  .map(([token, classes]) => {
    const names = ROLE_STYLES.filter((r) => r[2] === token).map((r) => r[0]).join(', ');
    return `/* ${names} */\n${classes.map((c) => `.pl-${c}`).join(',\n')} {\n${decl(token)}\n}`;
  })
  .join('\n\n')}
`;

writeFileSync(join(dir, 'typography.css'), out);
console.log(`Wrote typography.css — ${Object.keys(tokenStyles).length} token styles, ${ROLE_STYLES.length} role styles`);

// Feed the reference page (file:// blocks fetch, so this is emitted as a global).
writeFileSync(
  join(dir, 'typography.js'),
  `// Generated by build-typography.mjs — do not edit by hand.\n` +
    `window.PL_ROLE_STYLES = ${JSON.stringify(
      ROLE_STYLES.map(([figma, cls, token]) => ({ figma, cls: 'pl-' + cls, token })),
      null,
      2
    )};\n`
);
