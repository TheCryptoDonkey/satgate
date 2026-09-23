# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability reporting:

https://github.com/TheCryptoDonkey/satgate/security/advisories/new

Do not open a public issue for a vulnerability. Include the satgate version, how it was configured (payment rails, auth mode, pricing mode) and steps to reproduce.

Payment handling itself lives in [toll-booth](https://github.com/forgesworn/toll-booth). If the flaw is in toll-booth rather than in satgate, report it there instead; if unsure, report it here.

## Supported versions

Only the latest release receives security fixes.

## What satgate holds

- **Macaroon root key** (`ROOT_KEY`, or `satgate.root-key` beside the database when generated). Anyone holding it can mint credentials.
- **Lightning backend credentials** (`LIGHTNING_KEY`, or the NWC URI file). These can move funds.
- **Upstream API key** (`UPSTREAM_API_KEY` or `--upstream-key-file`), when the upstream needs one.
- **SQLite database** (`satgate.db` by default): credit balances, invoices and settlement records.

Keep these out of version control and readable only by the user satgate runs as.
