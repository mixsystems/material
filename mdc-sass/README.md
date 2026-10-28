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

`../build.sh` builds the patched packages and `@blox/material`, then publishes them as tag
`dist-<version>` of the repository, a commit that holds only the tarballs. npm downloads them from
`https://raw.githubusercontent.com/<owner>/<repo>/dist-<version>/`. The packages reference each other
by that URL (`@blox/material` → `material-components-web` → `@material/*`), so it is a build input
(`RELEASE_URL`), and an application only replaces its dependency:

```json
"@blox/material": "https://raw.githubusercontent.com/mixsystems/material/dist-0.17.0-ng22.0/blox-material-0.17.0-ng22.0.tgz"
```

Every build needs a new `version` in `bundle/package.json`. Never replace a published tag: `npm ci`
checks the integrity hashes in the lockfile. If `SUFFIX` in `build.mjs` changes, update the
`material-components-web` file name in `bundle/package.json`'s `build` script too. The repository must
be public: npm can't download from a private one.

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
