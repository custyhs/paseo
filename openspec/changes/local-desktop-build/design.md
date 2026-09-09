## Context

See proposal.md for the failure. Facts that shape the fix:

- electron-builder 26 signs ad-hoc when it finds no identity (`app-builder-lib/out/macPackager.js`, "falling back to ad-hoc signature"). It still applies `hardenedRuntime` and the release entitlements, which do not disable library validation.
- Library validation is a property of each process. Re-signing only the outer bundle lets the main process start while every `Paseo Helper*.app` still aborts; a fix has to cover the whole bundle, which a build-time config does and a post-build script would have to replicate.
- The desktop `build` script hardcodes `--config electron-builder.yml`; electron-builder resolves a second `--config` unpredictably through yargs, so the local path needs its own script rather than extra flags on the existing one.
- electron-builder supports `extends: <path>` (`app-builder-lib/out/util/config/config.js`, `loadParentConfigsRecursively`), so an overlay can inherit the release config verbatim.
- Fork rule: prefer new files at extension points over editing upstream files.

## Goals / Non-Goals

**Goals:**

- One command from the repo root that yields an installable, launchable local build.
- The release config stays the single source of truth for everything except the four local overrides.

**Non-Goals:**

- Making ad-hoc builds distributable or notarized.
- Auto-detecting the missing identity inside the release script. That would change CI behavior on a misconfigured runner from "fail loudly" to "ship an unhardened app".

## Decisions

### Overlay config file, not CLI dot-notation overrides

`electron-builder.local.yml` uses `extends: ./electron-builder.yml` and sets `mac.hardenedRuntime: false` and `mac.notarize: false`. A file carries the explanation next to the values and does not depend on yargs coercing `-c.mac.hardenedRuntime=false` from a string to a boolean.

### Identity discovery off through the environment, publishing off through the flag

`CSC_IDENTITY_AUTO_DISCOVERY=false` is what the successful local build already used; it goes into the `build:local` script so nobody has to remember it. `--publish never` guards against the default `onTagOrDraft` policy publishing from a checkout that happens to sit on a release tag with a token in the environment.

### Two one-line scripts instead of duplicating the build steps

`build:desktop:local` at the root mirrors `build:desktop` and delegates to `build:local` in the desktop workspace, which mirrors `build` there. Each mirror differs from its sibling by one clause, so an upstream change to either pipeline is a one-line rebase.

## Risks / Trade-offs

- [Upstream renames or restructures the desktop `build` script] → the sibling `build:local` line conflicts on rebase; resolution is re-deriving it from the new `build` line.
- [An ad-hoc build is copied to another Mac] → Gatekeeper blocks it; the doc states the build is for the building machine only.
- [Someone runs the local script in CI] → nothing publishes and the artifact is unhardened; the script name makes the intent visible.
