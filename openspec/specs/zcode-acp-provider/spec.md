# zcode-acp-provider Specification

## Purpose

Offer ZCode, Z.ai's GLM coding agent, as an installable ACP provider, and state the host configuration it needs so that installing it does not produce a session that fails on its first prompt.

## Requirements

### Requirement: ZCode is offered in the ACP provider catalog

The ACP provider catalog SHALL list ZCode with the command that starts its adapter and a link to the adapter's project. The entry SHALL carry no environment defaults, because the adapter's binary path differs per machine and per platform while the catalog is evaluated on the client and the process is spawned on the host.

#### Scenario: ZCode appears in the catalog

- **WHEN** the user opens the ACP provider catalog
- **THEN** ZCode is listed and can be installed

### Requirement: The catalog states the configuration ZCode requires

The ZCode entry SHALL state that it requires a host-side path to the CLI bundled inside the ZCode desktop app, and SHALL point at the documentation that shows how to set it. Documentation SHALL record that installing ZCode without that path creates a session successfully and then fails on the first prompt.

#### Scenario: Installing without the required path

- **WHEN** the user installs ZCode without configuring the host-side binary path and sends a first prompt
- **THEN** the documented failure mode explains that the missing path, not the prompt, is the cause
