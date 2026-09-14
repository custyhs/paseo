## Purpose

Deliver durable prompt drafts as an installable Paseo plugin, so any Paseo 0.8 host can keep, refine, send, and search drafts without a custom build of the daemon or the app.

## ADDED Requirements

### Requirement: The plugin installs on a stock Paseo 0.8 host

The plugin SHALL be installable from its public Git repository with `paseo plugin add custyhs/paseo-drafts` on a daemon with plugins enabled, and SHALL declare a Paseo requirement of `>=0.8.0`, which a `0.8.0-beta.1` daemon and app also satisfy. Once installed and enabled it SHALL contribute a Drafts sidebar item, a Scratchpad workspace panel, a plugin settings screen, and a "New draft" Command Center item, with no change to the daemon or the app.

#### Scenario: Installing on a compatible host

- **WHEN** the plugin is added to a daemon running Paseo 0.8.0 with plugins enabled and a 0.8.0 app connects
- **THEN** Drafts appears in the sidebar, Scratchpad appears in the workspace tab launcher, and the plugin's settings screen appears under Settings → Plugins

#### Scenario: A host that predates plugins

- **WHEN** the plugin is added to a daemon running Paseo 0.7.2
- **THEN** the install is rejected with Paseo's version diagnostic naming the required range, and nothing is installed

### Requirement: Storage is owned by the plugin

Drafts SHALL be stored on the daemon host under `<config>/paseo/drafts`, where `<config>` is `$XDG_CONFIG_HOME` when set and `~/.config` otherwise, unless the plugin's settings name another absolute directory. The layout SHALL be one directory per draft holding `artifact.json`, `snapshots/<rev>.json` written once per sent revision, and an append-only `dispatches.jsonl`, byte-compatible with the core implementation's files. Changing the directory in settings SHALL open the other directory without a daemon restart and SHALL NOT move files.

#### Scenario: Default location

- **WHEN** a draft is created on a host with no directory setting and `XDG_CONFIG_HOME` unset
- **THEN** its files appear under `~/.config/paseo/drafts/<artifactId>/`

#### Scenario: A directory copied from the core implementation

- **WHEN** the contents of a core `$PASEO_HOME/drafts` directory are copied into the plugin's directory and the plugin is reloaded
- **THEN** every copied draft is listed with its title, body, version, plans, revisions, and dispatch history

#### Scenario: The directory setting changes

- **WHEN** the directory setting is saved with another absolute path
- **THEN** the Drafts list shows the drafts in that path, and the previous directory is left unchanged

### Requirement: Unusable storage is reported, never shown as empty

When the storage directory cannot be created or read, every drafts operation SHALL fail with an error that names the directory and the cause, and the Drafts surface and Scratchpad panel SHALL display that error instead of an empty list. A directory that is merely absent SHALL be created.

#### Scenario: The directory cannot be read

- **WHEN** the configured directory exists but is not readable by the daemon user
- **THEN** the Drafts surface shows the directory path and the read error, and offers no way to create a draft

### Requirement: A draft outlives every session

A draft SHALL belong to no agent, workspace, or tab, and SHALL survive a client reload, a client restart, a plugin reload, and a daemon restart. Each draft SHALL carry a title, a body, and a monotonic version that increases on every accepted write.

#### Scenario: A draft survives a daemon restart

- **WHEN** a draft with a body is written, the daemon is restarted, and the Drafts surface is opened again
- **THEN** the draft appears with the same title, body, and version

### Requirement: Drafts are created, edited, and listed from one surface

The Drafts surface SHALL list the drafts of the selected host, allow creating a new draft, editing its title and body, and opening any listed draft. A draft with no title SHALL be listed by the first non-empty line of its body, or as "Untitled" when the body is empty too. A draft that was created and never received a title, body, or send SHALL be discarded when the editor is left.

#### Scenario: A new draft is created and edited

- **WHEN** the user activates "New draft" and types a title and a body
- **THEN** the draft appears in the list with that title, and reopening it shows the same body

#### Scenario: An empty draft is discarded

- **WHEN** the user creates a draft, writes nothing, and opens another draft or leaves the surface
- **THEN** the empty draft is not listed and no files remain for it

### Requirement: Editing is saved automatically after a pause

The editor SHALL write pending edits to the host after a pause in typing rather than on every keystroke, SHALL write title and body together, and SHALL display exactly one of saved, saving, not saved, or changed elsewhere. It SHALL NOT display saved for text the host has not accepted.

#### Scenario: A pause earns a write

- **WHEN** the user types into the body and stops
- **THEN** the text is written to the host and the editor reports saved

#### Scenario: A rejected write is reported as unsaved

- **WHEN** the host rejects or cannot receive the write
- **THEN** the editor reports not saved and keeps the text queued for retry

### Requirement: A concurrent edit is surfaced as an explicit choice

When a write is rejected because the draft changed elsewhere, the editor SHALL present the record as it now stands and SHALL offer both reload (keep the other version) and overwrite (put the local text on top of the version shown). Neither SHALL be applied automatically.

#### Scenario: Another client edited the same draft

- **WHEN** a second client saves a change to a draft this editor has pending edits for
- **THEN** the editor reports changed elsewhere and offers reload and overwrite

#### Scenario: Overwrite retries against the version shown

- **WHEN** the user chooses overwrite
- **THEN** the local text is written on top of the version the conflict presented, and the draft ends at that text

### Requirement: A draft declares where it is planned to run

A draft SHALL accept zero or more planned targets, each a workspace or a project of the selected host. A project-level plan SHALL be accepted when no workspace exists for it yet. Targets SHALL be removable, and a draft with no target SHALL be valid.

#### Scenario: A draft is planned for two workspaces

- **WHEN** the user adds two workspaces as planned targets
- **THEN** both are shown on the draft, and the draft appears in each workspace's Scratchpad panel

### Requirement: Planned-here status is derived, never stored

Whether a draft is awaiting execution in a workspace SHALL be derived from its plans and its dispatch history: planned for that workspace, directly or through its project, and its current version not yet sent there. The user SHALL NOT mark a draft done, pending, or reopened.

#### Scenario: Sending moves a draft out of the planned section

- **WHEN** the current revision of a planned draft is sent into that workspace
- **THEN** the draft leaves the planned section and appears in the section for what has run there

#### Scenario: Editing after a send returns a draft to planned

- **WHEN** the body of an already-sent draft is edited
- **THEN** the draft returns to the planned section for that workspace, marked as having unsent changes

### Requirement: Sending is one host-side operation with an immutable snapshot

A send SHALL be performed by the plugin's daemon-side process in one request: capture a byte-exact snapshot of the body at its current version, deliver it to the target, and append a dispatch record carrying the revision, the target agent when known, the target workspace, the correlation id shared with the delivered message, the outcome, and any error. A captured snapshot SHALL NOT be rewritten by any later edit or send. Capturing the same revision twice SHALL reuse the existing snapshot.

#### Scenario: A later edit does not change what was sent

- **WHEN** a draft is sent, then edited, and the sent revision is opened from its history
- **THEN** the opened revision shows the text as it was at send time

#### Scenario: One revision sent twice is one history row

- **WHEN** the same revision is sent to two targets
- **THEN** the history shows one row for that revision, recording two sends

### Requirement: A send targets a new agent or an existing session

The send flow SHALL offer starting a new agent in a workspace of the selected host with a provider the user chooses, and sending to an existing agent session, SHALL mark targets the draft is planned for, SHALL leave the draft open and editable, and SHALL offer a way through to the agent after a successful send. A host with no workspace SHALL say so rather than show an empty list.

#### Scenario: Sending to a new agent

- **WHEN** the user sends a draft as a new agent in a workspace
- **THEN** a new session starts with that revision as its first message, the draft stays open, and the confirmation opens the new agent

#### Scenario: Sending to an existing session

- **WHEN** the user sends a draft to a running agent session
- **THEN** the revision is delivered to that session and the confirmation opens it

### Requirement: A failed send is visible and keeps its lineage

When delivery fails, the response SHALL carry the failure reason, the editor SHALL show it, and the dispatch SHALL be recorded as failed with that reason. The snapshot SHALL be kept. A failure SHALL NOT be reported as a successful send.

#### Scenario: The host rejects the delivery

- **WHEN** the agent cannot be created or the message cannot be delivered
- **THEN** the editor shows the reason, and the history shows that revision's dispatch as failed

### Requirement: Sending never sends stale text

Before a send, the editor SHALL write any pending edit and wait for the host to accept it. When that write is not accepted, the send SHALL be refused with the reason and no snapshot SHALL be captured.

#### Scenario: Send immediately after typing

- **WHEN** the user types a change and sends before the autosave pause has elapsed
- **THEN** the captured revision contains the typed change

#### Scenario: Send while the host is unreachable

- **WHEN** the user sends a draft that has a pending edit and the host is unreachable
- **THEN** the send is refused with the reason and no revision is captured

### Requirement: Unsaved text survives a rejected write and a restart on web clients

On web clients, text the host has not accepted SHALL be checkpointed locally without expiry and removed only once the host accepts it. Reopening a draft SHALL restore any checkpointed text into the editor, queue it for writing, retry it without a keystroke, and report not saved until the host accepts it. A title-only edit SHALL checkpoint the title and no body. On iOS and Android clients no checkpoint SHALL be written, and the editor SHALL still report not saved while text is pending. While a host is disconnected Paseo replaces every plugin surface with its own unavailable state, so the draft is reopened once the host is reachable again; the surface SHALL list drafts this client still owes text for while the host reports unreachable.

#### Scenario: The web client restarts with unsaved text

- **WHEN** the host refuses a write, the user keeps typing in a browser, the page is reloaded, and the draft is reopened
- **THEN** the editor shows the typed text, reports not saved, and writes it once the host accepts writes again

#### Scenario: A checkpoint is dropped only after the host has the text

- **WHEN** a queued write is accepted by the host
- **THEN** the local checkpoint for that draft is removed

### Requirement: The Scratchpad panel drafts the next instruction inside a workspace

A workspace SHALL be able to open a Scratchpad panel showing the drafts planned for it and the drafts that have run there, allowing creating a draft planned for that workspace and editing it in place, and offering a way to the full Drafts surface. The panel SHALL be openable while an agent runs in the same workspace, SHALL be available from the tab launcher and the Explorer, and SHALL be restored after a client reload.

#### Scenario: Writing the next instruction while an agent runs

- **WHEN** an agent is running and the user opens the Scratchpad panel and writes a draft
- **THEN** the draft is saved and listed as planned for that workspace without interrupting the agent

#### Scenario: Nothing is planned yet

- **WHEN** a workspace has no drafts planned for it
- **THEN** the panel says so and states that a draft started there is planned for that workspace

### Requirement: Search covers current bodies and sent revisions

The Drafts surface SHALL search titles, current bodies, and captured revisions of the selected host. A result matched in a revision SHALL name that revision and show the surrounding text. A search with no results SHALL say so.

#### Scenario: A phrase that only exists in an older revision

- **WHEN** a draft's body no longer contains a phrase but a sent revision does, and the user searches for it
- **THEN** the draft is listed as a match, naming the revision it was found in, with an excerpt

#### Scenario: A search with no matches

- **WHEN** the user searches for a phrase no draft contains
- **THEN** the surface says no drafts match that search

### Requirement: Archived drafts leave the list and can return

A draft SHALL be archivable and unarchivable. An archived draft SHALL be excluded from the default list and from planned-here status, SHALL remain reachable through an archived group that reports its count, and SHALL keep its history and revisions.

#### Scenario: Archiving removes a draft from the list

- **WHEN** the user archives a draft
- **THEN** it disappears from the default list and from every planned section, and the archived group reports its count

#### Scenario: An archived draft is restored

- **WHEN** the user opens the archived group and unarchives a draft
- **THEN** the draft returns to the list with its history and revisions intact

### Requirement: Drafts are scoped to one host at a time

The Drafts surface SHALL show the drafts of the selected host only. When several connected hosts have the plugin, Paseo's host picker in the surface header SHALL switch between them. Drafts SHALL NOT be copied or synchronised between hosts, and an offline selected host SHALL be reported as unreachable rather than served from another host.

#### Scenario: Two connected hosts

- **WHEN** two hosts with the plugin are connected and each owns drafts
- **THEN** the surface lists one host's drafts at a time, switching with the host picker, and editing writes only to the selected host

### Requirement: Changes made elsewhere become visible on a bounded interval

While the Drafts surface or a Scratchpad panel is open, drafts created, edited, sent, or archived by another client of the same host SHALL become visible within 15 seconds. The client's own writes SHALL be reflected immediately.

#### Scenario: Another client creates a draft

- **WHEN** a second client creates a draft while this client's Drafts surface is open
- **THEN** the draft appears in this client's list within 15 seconds

### Requirement: The interface language is a host setting

The plugin SHALL offer an interface language setting with the values automatic, English, and Simplified Chinese, stored per host installation. Automatic SHALL resolve to Simplified Chinese when the device locale starts with `zh` and to English otherwise. Changing the setting SHALL re-render open drafts surfaces without a reload.

#### Scenario: A Chinese device with the automatic setting

- **WHEN** the setting is automatic and the device locale is `zh-CN`
- **THEN** the Drafts surface, the Scratchpad panel, and the settings screen show Simplified Chinese labels

#### Scenario: Switching to English

- **WHEN** the user changes the setting to English while the Drafts surface is open
- **THEN** the surface shows English labels without a reload

### Requirement: Every drafts operation requires the host's manage permission

Reading, creating, editing, planning, archiving, sending, and searching drafts SHALL require the host's manage permission, because plugin requests carry no finer grant. A principal without it SHALL see the host's permission error rather than an empty list.

#### Scenario: A read-only principal

- **WHEN** a principal with read permission but not manage permission opens the Drafts surface
- **THEN** the surface shows the permission error and lists nothing

### Requirement: "New draft" is reachable from the Command Center

A "New draft" Command Center item SHALL exist. Invoked in a workspace context it SHALL create a draft planned for that workspace and open the Scratchpad panel on it; invoked globally it SHALL open the Drafts surface on a new draft.

#### Scenario: New draft from a workspace

- **WHEN** the user runs "New draft" from the Command Center while a workspace is active
- **THEN** the Scratchpad panel opens in that workspace with a new draft planned for it
