// Theming rule: styles.css takes everything a theme expresses (colours, font families, corner
// radius, shadows) from tokens declared in theme.css; structure (spacing, sizes, z-index,
// transitions) stays literal. See docs/extending.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Innermost rule blocks with their selectors (at-rule wrappers are skipped by matching only `sel{decls}`).
const declarations = css => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
  [...body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)].map(([, prop, value]) => ({selector: selector.trim().replace(/\s+/g, ' '), prop, value: value.trim()})));

const neutral = /^(transparent|none|inherit|currentColor|Canvas|CanvasText|0|0px)$/;
const colourLiteral = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
const borderWidthOnly = /^[\d.]+px solid$/;
// The two structural radii: the focus ring and the dash of a dropped item. Every selector in a list must match.
const radiusExceptions = {'2px': /:focus-visible$/, '1px': /^\.item\[data-state="dropped"\] \.box::after$/};

function violation({selector, prop, value}) {
  const token = /var\(--/.test(value);
  if (/radius$/.test(prop)) {
    if (value === 'var(--radius)' || neutral.test(value)) return false;
    const rule = radiusExceptions[value];
    return !(rule && selector.split(',').every(s => rule.test(s.trim())));
  }
  if (prop === 'font-family') return !(token || value === 'inherit');
  if (prop === 'font') return !(value === 'inherit' || /var\(--font-/.test(value));
  if (/color|^background|^border(-(top|right|bottom|left))?$|^outline$|shadow$|^fill$|^stroke$/.test(prop)) {
    if (colourLiteral.test(value)) return true;
    if (/shadow$/.test(prop)) return !(neutral.test(value) || /^var\(--[\w-]+\)$/.test(value));
    return !(token || neutral.test(value) || borderWidthOnly.test(value));
  }
  return false;
}
const violations = css => declarations(css).filter(violation);

test('styles.css follows the theming rule', () => {
  assert.deepEqual(violations(read('styles.css')), []);
});

test('the rule catches literals that a theme could not change', () => {
  for (const css of [
    '.x{background:red}', '.x{color:#123}', '.x{border:1px solid #ccc}', '.x{text-shadow:0 2px 8px red}',
    '.x{box-shadow:0 2px 8px var(--ink)}', '.x{background:linear-gradient(var(--ground),#f00)}',
    '.x{font-family:Arial}', '.x{font:12px Georgia}', '.x{border-top-left-radius:9px}',
    'a:focus-visible,.x{border-radius:2px}', '.focus-visible{border-radius:2px}',
  ]) assert.equal(violations(css).length, 1, css);
});

test('every token styles.css uses is declared in theme.css or has a fallback', () => {
  const declared = new Set([...read('theme.css').matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  const missing = [...read('styles.css').matchAll(/var\((--[\w-]+)\s*(,)?/g)].filter(m => !m[2] && !declared.has(m[1])).map(m => m[1]);
  assert.deepEqual([...new Set(missing)], []);
});
