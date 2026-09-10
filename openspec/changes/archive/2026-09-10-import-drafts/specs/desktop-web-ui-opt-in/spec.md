## Purpose

Let someone running the desktop app still reach that machine's daemon from another device's browser, by honouring an explicit web UI opt-in in daemon config instead of silently overriding it.

## ADDED Requirements

### Requirement: An explicit web UI opt-in survives the desktop default

The desktop app SHALL continue to start its managed daemon with the web UI disabled by default, and SHALL honour an explicit opt-in in the daemon's persisted configuration. An explicit opt-out and an absent setting SHALL both keep the default. Configuration that cannot be read SHALL be treated as asking for nothing.

#### Scenario: Config explicitly enables the web UI

- **WHEN** the daemon's persisted configuration explicitly enables the web UI and the desktop app starts its managed daemon
- **THEN** the daemon serves the web UI, and it is reachable from a browser on another device

#### Scenario: No setting present

- **WHEN** the persisted configuration says nothing about the web UI
- **THEN** the desktop app starts the daemon with the web UI disabled

#### Scenario: Unreadable config

- **WHEN** the persisted configuration cannot be read
- **THEN** the desktop app starts the daemon with the web UI disabled
