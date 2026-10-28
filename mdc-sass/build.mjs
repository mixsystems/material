// Builds patched copies of the material-components-web 0.37.1 packages into build/node_modules
// and packs them into dist/*.tgz, to be uploaded as assets of one GitHub release.
// The packages depend on each other through RELEASE_URL, so installing @blox/material pulls in the
// patched set at the usual node_modules/@material/* paths, with nothing to configure in the app.
import {execFileSync} from 'node:child_process';
import {cpSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {transform} from './transform.mjs';

const SUFFIX = 'sass.1';
const RELEASE_URL = process.env.RELEASE_URL;
if (!RELEASE_URL?.endsWith('/')) throw new Error('Set RELEASE_URL to the release download URL, ending with "/"');
const tarball = (name, version) => `${name.replace('@', '').replace('/', '-')}-${version}.tgz`;
const src = 'node_modules';
const out = 'build/node_modules';
rmSync('build', {recursive: true, force: true});
rmSync('dist', {recursive: true, force: true});
mkdirSync('dist');

const packages = ['material-components-web', ...globSync('@material/*', {cwd: src})]
  .filter((pkg) => globSync('**/*.scss', {cwd: join(src, pkg)}).length);
for (const pkg of packages) {
  cpSync(join(src, pkg), join(out, pkg), {recursive: true, filter: (p) => !p.includes('/node_modules/', src.length + 1)});
}

const files = globSync('**/*.scss', {cwd: out}).map((f) => join(out, f));
// Official migrators for everything deprecated in Dart Sass 2/3 that is internal to MDC: `/` division
// (no multiplication rewrite, so values stay bit-identical), legacy color functions, legacy if() and
// global built-in functions. Only @import is left: it's how applications theme MDC 0.37.
const migrate = (...args) => execFileSync('node_modules/.bin/sass-migrator', [...args, '--load-path', out, ...files], {stdio: 'inherit'});
migrate('division', '--no-multiplication');
migrate('color');
migrate('if-function');
migrate('module', '--built-in-only');
// Left by the migrator because CSS has max() too; this one mixes units, so it must stay Sass's math.max().
const textfield = join(out, '@material/textfield/_mixins.scss');
const original = readFileSync(textfield, 'utf8');
if (!original.includes('max($radius - 2, 0)')) throw new Error(`${textfield}: expected max($radius - 2, 0)`);
const fixed = original.replace('max($radius - 2, 0)', 'math.max($radius - 2, 0)');
writeFileSync(textfield, fixed.includes('@use "sass:math"') ? fixed : `@use "sass:math";\n${fixed}`);
for (const f of files) writeFileSync(f, transform(readFileSync(f, 'utf8')));

const manifests = Object.fromEntries(packages.map((pkg) => [pkg, JSON.parse(readFileSync(join(out, pkg, 'package.json'), 'utf8'))]));
for (const manifest of Object.values(manifests)) manifest.version = `${manifest.version}-${SUFFIX}`;
for (const [pkg, manifest] of Object.entries(manifests)) {
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    if (manifests[dep]) manifest.dependencies[dep] = RELEASE_URL + tarball(dep, manifests[dep].version);
  }
  writeFileSync(join(out, pkg, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  execFileSync('npm', ['pack', '--pack-destination', resolve('dist'), '--silent'], {cwd: join(out, pkg)});
}
console.log(`patched ${files.length} files in ${packages.length} packages -> dist/`);
