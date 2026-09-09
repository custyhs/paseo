## 1. Build path

- [x] 1.1 Add `packages/desktop/electron-builder.local.yml` extending the release config with hardened runtime and notarization off; verify `electron-builder` loads it (the build log shows `loaded configuration file=.../electron-builder.local.yml` with no `extends` error)
- [x] 1.2 Add `build:local` to `packages/desktop/package.json` and `build:desktop:local` to the root `package.json`; verify `npm run build:desktop:local` completes on this machine and `codesign -dvv` on the produced `Paseo.app` and every `Paseo Helper*.app` shows `adhoc` without `runtime`

## 2. Documentation

- [x] 2.1 Add a "Local desktop package" section to `docs/development.md` after the Nix section; verify `npm run format:check:files -- docs/development.md` passes
