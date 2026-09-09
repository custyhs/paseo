## Purpose

Produce a macOS desktop build that launches on the machine that built it when no Apple signing identity is available, so fork features can be installed locally without re-signing by hand.

## ADDED Requirements

### Requirement: Local build launches without a signing identity

Running `npm run build:desktop:local` on a Mac with no code-signing identity SHALL produce `Paseo-<version>-<arch>.dmg` and `.zip` under `packages/desktop/release/` whose app bundle, and every helper app inside it, is ad-hoc signed without the hardened runtime flag, so the installed app and its helper processes start instead of aborting at dyld.

#### Scenario: Build on a machine with zero identities

- **WHEN** `security find-identity -v -p codesigning` reports no identities and the user runs `npm run build:desktop:local`
- **THEN** the build completes without a signing or notarization error, and `codesign -dvv` on `Paseo.app` and on each `Paseo Helper*.app` reports `adhoc` without `runtime`

#### Scenario: Installed local build starts

- **WHEN** the produced dmg is installed to `/Applications` and opened
- **THEN** the main process, the GPU, renderer, and utility helpers stay alive and the managed daemon listens on port 6767

### Requirement: Local build inherits the release configuration

The local build SHALL differ from `npm run build:desktop` only in hardened runtime, notarization, identity discovery, and publishing. Targets, bundled resources, entitlements, and protocols SHALL follow the release configuration.

#### Scenario: Release config gains a new resource

- **WHEN** `packages/desktop/electron-builder.yml` adds an `extraResources` entry
- **THEN** the next `npm run build:desktop:local` includes that resource without any change to the local overlay

### Requirement: Local build never publishes

The local build SHALL NOT upload artifacts to GitHub Releases even when a GitHub token is present in the environment or the checkout is on a release tag.

#### Scenario: Token in environment

- **WHEN** `GH_TOKEN` is set and the user runs `npm run build:desktop:local`
- **THEN** no release or asset is created on GitHub
