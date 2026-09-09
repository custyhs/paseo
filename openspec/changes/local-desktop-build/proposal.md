## Why

`npm run build:desktop` on a Mac without a Developer ID certificate produces an app that aborts at launch: electron-builder falls back to an ad-hoc signature while the release config keeps the hardened runtime on, and a hardened process refuses to load ad-hoc libraries (`Library not loaded: @rpath/Electron Framework.framework/Electron Framework ... different Team IDs`). Every helper process dies the same way. The fork exists to be built and installed locally, so a launchable local build has to be a one-command path, not a manual re-sign after every build.

## What Changes

- Add `npm run build:desktop:local`, which builds the same artifacts as `build:desktop` (dmg and zip under `packages/desktop/release/`) with the hardened runtime off, notarization off, code-signing identity discovery off, and publishing disabled.
- Add `packages/desktop/electron-builder.local.yml`, an `extends` overlay on the release config that carries only those overrides and the reason for them.
- Document the command in `docs/development.md` next to the Nix desktop package section.
- Out of scope: signed or notarized local builds, Windows and Linux local packaging, changing the release configuration CI uses.

## Capabilities

### New Capabilities

- `local-desktop-build`: a launchable macOS desktop build from a checkout with no signing identity.

### Modified Capabilities

None.

## Impact

- No runtime code changes. The release config and CI path are untouched; the overlay only applies when the new script is used.
- Local builds are ad-hoc signed: they launch on the machine that built them but are not distributable.

## Upstream impact

| File                            | Change                                        | Conflict risk |
| ------------------------------- | --------------------------------------------- | ------------- |
| `package.json` (root)           | one `build:desktop:local` script line         | low           |
| `packages/desktop/package.json` | one `build:local` script line                 | low           |
| `docs/development.md`           | one short section after "Nix desktop package" | low           |

Purely new: `packages/desktop/electron-builder.local.yml`. The release config `electron-builder.yml` is not edited; the overlay inherits it, so upstream changes to targets, files, or entitlements flow through.
