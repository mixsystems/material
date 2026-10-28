# mdc-sass

Patched SCSS for `material-components-web@0.37.1` (the version used by `@blox/material@0.17`), so
that current Dart Sass (`sass` / `sass-embedded` 1.97.1 or newer; Angular 22 ships 1.104) produces the
same CSS as the Sass the application was built with before. JavaScript is untouched. Older Sass can't
compile the migrated `if()` syntax.

## Why

- **Declaration order (Sass >= 1.92).** Declarations written after nested rules, which MDC does about
  380 times (mostly through mixins), are now emitted after those rules instead of being hoisted above
  them. That changes the cascade: for example, `.mdc-slider` overrides `.mdc-slider--disabled`, so a
  disabled slider gets a pointer cursor. `transform.mjs` makes every MDC rule emit its declarations
  first and its nested rules second, which is what older Sass did.
- **Deprecations.** The official `sass-migrator` rewrites `/` division (removed in Dart Sass 2), legacy
  color functions, legacy `if()` and global built-in functions. The only deprecation left is `@import`,
  because that is how applications theme MDC 0.37 (`$mdc-theme-*` variables, then `@import`).

## Release

The patched packages, `@blox/material` and `@angular/flex-layout` are uploaded as assets of one
GitHub release. They reference each other by that release's download URL (`@blox/material` →
`material-components-web` → `@material/*`). So the URL is a build input, and an application only
replaces its two dependencies. From `forks/material`:

```sh
export RELEASE_URL=https://github.com/<owner>/<repo>/releases/download/<tag>/
(cd mdc-sass && npm ci && npm run build && npm run verify)
(cd bundle && npm ci && npm run build)
(cd ../flex-layout && npm ci && npm run build)
gh release create <tag> --repo <owner>/<repo> mdc-sass/dist/*.tgz bundle/*.tgz ../flex-layout/dist/*.tgz
```

```json
"@angular/flex-layout": "https://github.com/<owner>/<repo>/releases/download/<tag>/angular-flex-layout-10.0.0-beta.32-ng22.0.tgz",
"@blox/material": "https://github.com/<owner>/<repo>/releases/download/<tag>/blox-material-0.17.0-ng22.0.tgz"
```

Every rebuild needs a new tag (never replace assets of a published release: `npm ci` checks the
integrity hashes in the lockfile). If `SUFFIX` in `build.mjs` changes, update the
`material-components-web` file name in `bundle/package.json`'s `build` script too. The repository must
be public: npm can't download private release assets.

`verify` compiles the full bundle (default and themed) and every `mdc-*.scss` with the latest `sass`
and `sass-embedded` on the patched sources, and with Sass 1.91 on the originals. It fails unless the
CSS is identical. Values whose only difference is spelling (`rgb(88%, …)` vs `rgb(224.4, …)`, `-0%`
vs `0%`) count as identical, because newer Sass prints them that way even without the patch.

## Application SCSS

The patch covers MDC's own files. Application rules that write declarations after a nested rule, or
after an MDC mixin that emits one, get the new ordering too. To list them, compile the app's global
stylesheet with Sass 1.91 and look for `mixed-decls` warnings in the app's own files:

```sh
npx sass@1.91.0 --load-path=node_modules --no-source-map src/styles.scss > /dev/null
```

Fix each one by moving the declarations above the nested rules.
