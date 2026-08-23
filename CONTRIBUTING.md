# Contributing to ChartViz Community

Thank you for helping improve ChartViz Community.

## Before opening a change

1. Open an issue for behavior or API changes so maintainers can confirm scope.
2. Keep Community self-hosted and useful without ChartViz Cloud services.
3. Do not add account, billing, quota, payment, private prompt, production
   dataset, or Cloud deployment code.
4. Never commit credentials, private charts, personal data, or generated `.env`
   files.

## Development checks

```bash
pnpm install --frozen-lockfile
pnpm exec wxt prepare
pnpm test
pnpm compile
pnpm build
pnpm build:edge
./scripts/verify-release.sh
```

Python changes must also pass:

```bash
uv run --project services/community/core --extra test pytest services/community/core/tests -q
uv run --project services/community --extra test pytest services/community/tests -q
```

Add a focused regression test for behavior changes. Keep public API changes
backward compatible within API version `1`.

## Sign-off and licensing

All commits must include a Developer Certificate of Origin sign-off:

```bash
git commit -s -m "your commit message"
```

The sign-off certifies the [Developer Certificate of Origin 1.1](https://developercertificate.org/).
Contributions are licensed according to the directory license map.

ChartViz Cloud does not automatically copy Community server contributions.
If maintainers later want to include a contribution in separately licensed
Cloud code, they will request a separate contributor agreement as described in
[`CLA.md`](CLA.md). Declining that separate agreement does not prevent an
otherwise acceptable Community contribution.

## Pull requests

- explain the user-visible behavior and security impact;
- include the commands and results used for verification;
- keep generated artifacts deterministic;
- do not modify generated OpenAPI or dependency inventories by hand;
- follow the code of conduct.
