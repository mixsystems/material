// Proves the patch: modern Sass on the patched sources must emit byte-identical CSS to
// Sass 1.91 (the last release with the old declaration ordering) on the original sources.
import {globSync} from 'node:fs';
import * as reference from 'sass-reference';
import * as sass from 'sass';
import * as embedded from 'sass-embedded';

const themed = `$mdc-theme-primary: #00897b;\n$mdc-theme-secondary: #ff6f00;\n$mdc-theme-background: #fafafa;\n`;
const entries = [
  ['bundle', '@import "material-components-web/material-components-web";'],
  ['bundle, themed', themed + '@import "material-components-web/material-components-web";'],
  ...globSync('@material/*/mdc-*.scss', {cwd: 'node_modules'}).map((f) => [f, `@import "${f}";`]),
];

const silent = {warn() {}};
const deprecations = new Map();
const counting = {warn(_, {deprecationType}) {
  const id = deprecationType?.id ?? 'other';
  deprecations.set(id, (deprecations.get(id) ?? 0) + 1);
}};

// Newer Sass also spells some values differently, with the same meaning: fractional color
// channels as percentages (rgb(224.4, ...) -> rgb(88%, ...)) and negative zero (-1 * 0% -> -0%).
// Only that spelling is normalized; it happens without the patch too.
const channel = (c, i) => {
  const v = c.trim();
  if (i === 3) return String(+(v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v)).toFixed(4));
  return String(+(v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v)).toFixed(4));
};
const spelling = (css) => css
  .replace(/rgba?\(([^()]*)\)/g, (_, args) => `rgb(${args.split(',').map(channel).join(', ')})`)
  .replace(/(?<![\w.])-0(?![.\d])/g, '0');

let failed = 0, spellingOnly = 0;
for (const [name, source] of entries) {
  const expected = reference.compileString(source, {loadPaths: ['node_modules'], logger: silent}).css;
  for (const [label, compiler] of [['sass', sass], ['sass-embedded', embedded]]) {
    const logger = label === 'sass' ? counting : silent;
    const actual = (await compiler.compileStringAsync(source, {loadPaths: ['build/node_modules'], logger})).css;
    if (actual === expected) continue;
    if (spelling(actual) === spelling(expected)) { spellingOnly++; continue; }
    failed++;
    console.log(`DIFF ${label} ${name}`);
  }
}
console.log(`${entries.length} entries x 2 compilers (sass ${sass.info.split('\t')[1]}): ${failed ? failed + ' FAILED' : 'all identical'}`
  + ` (${spellingOnly} only after normalizing value spelling)`);
console.log('remaining deprecation warnings:', Object.fromEntries(deprecations));
process.exit(failed ? 1 : 0);
