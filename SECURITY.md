# Security policy

## Supported versions

Security fixes are provided for the latest tagged release. Upgrade before
reporting a problem that affects an older release only.

## Reporting a vulnerability

Email `support@chartviz.xyz` with the subject `ChartViz Community security`.
Do not open a public issue for a suspected vulnerability and do not include
provider keys, local API tokens, private chart screenshots, or personal data in
public discussions.

Include the affected version, component, reproduction steps, impact, and any
suggested mitigation. You should receive an acknowledgement within five
business days. Maintainers will coordinate validation, remediation, and
disclosure timing with the reporter.

## Deployment responsibility

Community is self-hosted. Operators are responsible for provider-key handling,
TLS, firewall rules, reverse-proxy configuration, backups, host updates, and
restricting access to `CHARTVIZ_DATA_DIR`. The default examples bind the server
to `127.0.0.1`; do not expose it directly to an untrusted network.
