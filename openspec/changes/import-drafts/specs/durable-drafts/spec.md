## Purpose

Keep a prompt that is worth writing carefully — one you refine over days, send to more than one agent, and later need to read back exactly as it was sent — as a durable record owned by the host rather than by the tab it was typed in.

## ADDED Requirements

### Requirement: A draft outlives every session

A draft SHALL be persisted by the host and SHALL belong to no agent, workspace, or tab. It SHALL survive a client reload, a client restart, and a daemon restart. Each draft SHALL carry a title, a body, and a monotonic version that increases on every accepted write.

#### Scenario: A draft survives a daemon restart

- **WHEN** a draft with a body is written, the daemon is restarted, and the Drafts list is opened again
- **THEN** the draft appears with the same title, body, and version

#### Scenario: A draft is not tied to the tab that created it

- **WHEN** a draft is created from a workspace, that workspace is archived, and the Drafts list is opened
- **THEN** the draft is still listed and still editable

### Requirement: Drafts are created, edited, and listed from one screen

The client SHALL offer a Drafts screen, reachable from the sidebar, that lists every draft on the connected hosts and allows creating a new draft, editing its title and body, and opening any listed draft for editing. A draft with no title SHALL be listed as "Untitled".

#### Scenario: A new draft is created and edited

- **WHEN** the user activates "New draft" and types a title and a body
- **THEN** the draft appears in the list with that title, and reopening it shows the same body

#### Scenario: An empty draft is discarded

- **WHEN** the user opens a newly created draft, writes nothing into it, and leaves the editor
- **THEN** the draft is discarded and does not appear in the list

### Requirement: Editing is saved automatically after a pause

The editor SHALL write pending edits to the host after a pause in typing rather than on every keystroke. Title and body SHALL be written together so they cannot race each other. The editor SHALL display which of saved, saving, not saved, or changed-elsewhere currently holds, and SHALL NOT display a saved state for text the host has not accepted.

#### Scenario: A pause earns a write

- **WHEN** the user types into the body and stops
- **THEN** the text is written to the host and the editor reports it as saved

#### Scenario: A rejected write is reported as unsaved

- **WHEN** the host rejects or cannot receive the write
- **THEN** the editor reports the text as not saved and keeps it queued for retry

### Requirement: A concurrent edit is surfaced as an explicit choice

When a write is rejected because the draft changed elsewhere, the client SHALL present the record as it now stands and SHALL offer both keeping the other version and putting the local version on top. Neither resolution SHALL be applied automatically.

#### Scenario: Another client edited the same draft

- **WHEN** a second client saves a change to a draft that this editor also has pending edits for
- **THEN** the editor reports the draft as changed elsewhere and offers reload and overwrite

#### Scenario: Reload keeps the other version

- **WHEN** the user chooses reload on a conflict
- **THEN** the editor shows the other client's text and the local pending edit is dropped

#### Scenario: Overwrite retries against the version that was shown

- **WHEN** the user chooses overwrite on a conflict
- **THEN** the local text is written on top of the version the conflict presented, and the draft ends at that text

### Requirement: A draft declares where it is planned to run

A draft SHALL be able to declare zero or more planned targets, each of which is a workspace or a project. Project-level planning SHALL be accepted when no workspace exists for it yet. Declared targets SHALL be freely removable, and a draft with no target SHALL be valid.

#### Scenario: A draft is planned for two workspaces

- **WHEN** the user adds two workspaces as planned targets
- **THEN** both are listed on the draft, and the draft appears in each of those workspaces' Scratchpad panels

#### Scenario: A draft is planned for a project before the workspace exists

- **WHEN** the user plans a draft for a project and a workspace is later created in that project
- **THEN** the draft appears in that workspace's Scratchpad panel, marked as reaching it through a project-level plan

### Requirement: Planned-here status is derived, never stored

Whether a draft is awaiting execution in a workspace SHALL be derived from its planned targets and its dispatch history: the draft is planned for that workspace and its current version has not yet been sent there. A workspace-level plan SHALL count only sends into that workspace; a project-level plan SHALL count sends into any workspace of that project. The user SHALL NOT have to mark a draft as done, pending, or reopened.

#### Scenario: Sending moves a draft out of the planned section

- **WHEN** the current revision of a planned draft is sent into that workspace
- **THEN** the draft leaves the planned section and appears in the section for what has run there

#### Scenario: Editing after a send returns a draft to planned

- **WHEN** the body of an already-sent draft is edited
- **THEN** the draft returns to the planned section for that workspace, marked as having unsent changes

### Requirement: Every send captures an immutable revision snapshot

Sending a draft SHALL capture a byte-exact copy of the body at that moment and SHALL append a dispatch record carrying the revision, the target agent when there is one, the target workspace, a correlation id shared with the delivered message, the send status, and any error. A captured snapshot SHALL NOT be rewritten by any later edit or send.

#### Scenario: A later edit does not change what was sent

- **WHEN** a draft is sent, then edited, and the sent revision is opened from its history
- **THEN** the opened revision shows the text as it was at send time, not the edited text

#### Scenario: One revision sent twice is one history row

- **WHEN** the same revision is sent to two different targets
- **THEN** the history shows one row for that revision, recording that it was sent more than once

### Requirement: A send targets a new agent or an existing session

The send flow SHALL offer starting a new agent in a workspace and sending to an existing agent session, SHALL mark targets the draft is planned for, and SHALL leave the draft open and editable after the send. A workspace with no possible target SHALL say so rather than offer an empty list.

#### Scenario: Sending to a new agent

- **WHEN** the user sends a draft as a new agent in a workspace
- **THEN** a new session starts with that revision as its first message, and the draft stays open

#### Scenario: Sending to an existing session

- **WHEN** the user sends a draft to a running agent session
- **THEN** the revision is delivered to that session, and the confirmation offers a way through to it

### Requirement: A failed send is visible and keeps its lineage

When a send cannot be delivered, the client SHALL report the failure with its reason, and the draft's history SHALL record the attempt with a failed status. A failure SHALL NOT be reported as a successful send, and SHALL NOT leave the draft's history claiming the revision was delivered.

#### Scenario: The host rejects the send

- **WHEN** a send fails
- **THEN** the editor shows the failure and its reason, and the history records that revision's dispatch as failed

### Requirement: Sending never sends stale text

A send SHALL write any pending edit to the host and wait for it to be accepted before the revision is captured. When that write cannot be accepted, the send SHALL be refused with the reason rather than capturing an older body.

#### Scenario: Send immediately after typing

- **WHEN** the user types a change and sends the draft before the autosave pause has elapsed
- **THEN** the captured revision contains the typed change

#### Scenario: Send while the host is unreachable

- **WHEN** the user sends a draft that has a pending edit the host has not accepted, and the host is unreachable
- **THEN** the send is refused with the reason, and no revision is captured

### Requirement: Unsaved text survives a disconnect and a restart

Text the host has not accepted SHALL be checkpointed on the client, without expiry, and SHALL be removed only once the host has accepted it. On reopening a draft, any checkpointed text for it SHALL be restored into the editor and queued for writing, and the editor SHALL report it as not saved until the host accepts it.

#### Scenario: The client restarts with unsaved text

- **WHEN** the host is unreachable, the user types into a draft, the client is restarted, and that draft is reopened
- **THEN** the editor shows the typed text, reports it as not saved, and writes it to the host once reachable

#### Scenario: A checkpoint is dropped only after the host has the text

- **WHEN** a queued write is accepted by the host
- **THEN** the local checkpoint for that draft is removed

#### Scenario: A title-only edit does not checkpoint a body

- **WHEN** only the title is edited while the host is unreachable
- **THEN** the checkpoint holds the title and no body, so no unedited body is later written back

### Requirement: The Scratchpad panel drafts the next instruction inside a workspace

A workspace SHALL be able to open a Scratchpad panel that shows the drafts planned for that workspace and the drafts that have already run there, allows creating and editing a draft in place, and offers a way through to the full Drafts screen. The panel SHALL be openable while an agent is running in the same workspace, and SHALL be restored after a client reload.

#### Scenario: Writing the next instruction while an agent runs

- **WHEN** an agent is running and the user opens the Scratchpad panel and writes a draft
- **THEN** the draft is saved and listed as planned for that workspace, without interrupting the running agent

#### Scenario: The panel is restored after a reload

- **WHEN** a Scratchpad panel is open and the client is reloaded
- **THEN** the panel is open again in the same workspace

#### Scenario: Nothing is planned yet

- **WHEN** a workspace has no drafts planned for it
- **THEN** the panel says so and states that a draft started there is planned for that workspace

### Requirement: Search covers current bodies and sent revisions

The Drafts screen SHALL offer a search across titles, current bodies, and captured revisions on every connected capable host. A result that matched a captured revision SHALL say which revision matched and SHALL show the surrounding text of the match. A search with no results SHALL say so rather than show an empty list.

#### Scenario: A phrase that only exists in an older revision

- **WHEN** a draft's body no longer contains a phrase but a sent revision does, and the user searches for it
- **THEN** the draft is listed as a match, identifying the revision it was found in

#### Scenario: A search with no matches

- **WHEN** the user searches for a phrase no draft contains
- **THEN** the screen says no drafts match that search

### Requirement: Archived drafts leave the list and can return

A draft SHALL be archivable and unarchivable. An archived draft SHALL be excluded from the default list and from planned-here status, SHALL remain retrievable through an explicit archived view, and SHALL keep its history and captured revisions. Recovering an archived draft SHALL NOT require remembering its text.

#### Scenario: Archiving removes a draft from the list

- **WHEN** the user archives a draft
- **THEN** it disappears from the default list and from every planned section, and the archived group reports its count

#### Scenario: An archived draft is restored

- **WHEN** the user opens the archived view and unarchives a draft
- **THEN** the draft returns to the list with its history and captured revisions intact

### Requirement: The list spans every capable host

The Drafts screen SHALL aggregate drafts from every connected host that advertises the capability, and SHALL make clear which host owns a draft. Drafts SHALL NOT be copied or synchronised between hosts.

#### Scenario: Two connected hosts

- **WHEN** two hosts are connected and each owns drafts
- **THEN** the screen lists the drafts of both, and editing one writes only to the host that owns it

### Requirement: The surface gates once on the host capability

The client SHALL gate the entire drafts surface on the host advertising drafts support. A connected host that does not advertise it SHALL be reported as not supporting drafts, with the remedy being to update that host. The client SHALL NOT offer a degraded or local-only substitute for a connected host.

#### Scenario: A host that predates the feature

- **WHEN** the client connects to a host that does not advertise drafts support
- **THEN** the drafts surface states that the host does not support drafts and that the daemon needs updating

#### Scenario: Draft storage is unavailable on the host

- **WHEN** the host cannot open its draft storage at startup
- **THEN** the host starts anyway with the rest of its features working, and does not advertise drafts support

### Requirement: Draft operations are authorized as host reads and writes

Reading drafts, revisions, and search results SHALL require the host's read permission. Creating, editing, planning, archiving, capturing a revision, and settling a dispatch SHALL require the host's manage permission.

#### Scenario: A read-only principal

- **WHEN** a principal with read permission but not manage permission lists drafts and then attempts to edit one
- **THEN** the list succeeds and the edit is refused
