# Security policy

Report a vulnerability privately to the maintainers rather than opening a public issue. Do not include API keys, screenshots containing sensitive information, or other secrets in a report.

This baseline has no account service, server, analytics, or persistent user data. Provider credentials are session-only and must never be exposed to page scripts, URLs, logs, or telemetry.

Runtime provider origins are fixed by the reviewed provider implementations and the extension manifest permissions. Manifest Version 3 content-security policy forbids remote code. Arbitrary monkey-patching by reviewed project source is outside this project's custom verification boundary; it is addressed through code review, lockfile review, ordinary tests, and browser platform protections rather than source-language analysis.
