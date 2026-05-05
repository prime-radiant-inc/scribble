# Security Policy

Scribble processes Slack messages, downloaded files, wiki contents, and API credentials. Treat deployments as sensitive workspace infrastructure.

## Supported Versions

Until the first public release is tagged, security fixes land on `main`.

## Reporting A Vulnerability

Please report suspected vulnerabilities privately to Prime Radiant maintainers instead of opening a public issue. Include:

- The affected version or commit
- A concise reproduction
- Expected and actual behavior
- Whether credentials, Slack data, wiki data, or Linear data may be exposed

We will confirm receipt, assess impact, and coordinate a fix before public disclosure.

## Self-Hosting Guidance

- Use a dedicated Slack app per workspace.
- Invite Scribble only to conversations where passive logging is acceptable.
- Use a dedicated wiki repo and a least-privilege GitHub token.
- Protect `DATA_DIRECTORY`; it can contain conversations, downloaded files, session state, and generated secret config.
- Rotate Slack, GitHub, Linear, and Anthropic credentials after any suspected data-directory exposure.

## Slack Manifest Scope

`slack-app-manifest.yaml` is the full-behavior profile and is intentionally broad. It is the only manifest shipped in this release; a minimal-scope alternative is not currently supported. If you need to restrict scopes, edit the manifest before installing the Slack app and accept that some Scribble features, including cross-channel context, global conversation search, and automatic channel join, may degrade or stop working accordingly.
