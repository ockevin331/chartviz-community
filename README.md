# ChartViz Community

ChartViz Community is a Chrome and Edge extension for chart education. This clean v1 baseline provides an installable panel and deliberately contains no analysis, provider, capture, annotation, or account behavior.

## Development

```bash
pnpm --dir extension install --frozen-lockfile
pnpm --dir extension test
pnpm --dir extension build
pnpm --dir extension build:edge
node scripts/audit-source.mjs
```

Load the generated unpacked extension from `extension/.output/chrome-mv3` or `extension/.output/edge-mv3`.

## Security boundary

The manifest requests only `activeTab`, `storage`, and `scripting`. Its only network origins are the documented OpenRouter, OpenAI, and Gemini API origins. See [SECURITY.md](SECURITY.md).
