# ChartViz Community

ChartViz Community is the self-hosted edition of the ChartViz browser
extension and chart-screenshot analysis server. It helps people read
candlestick charts for research and education. It does not place trades and
does not provide personalized investment advice.

The Community edition:

- analyzes one screenshot and one timeframe per task;
- connects the extension directly to your server with a local API token;
- uses one OpenAI-compatible multimodal request with your own provider key;
- stores tasks in SQLite and images on the local filesystem;
- has no ChartViz account, website login, subscription, quota, payment, or
  hosted-model flow.

ChartViz Cloud uses the same public report contract but adds a private analysis
pipeline, managed identity, billing, market-data enrichment, and distributed
operations. Those services are not part of this repository.

## Repository layout

```text
entrypoints/                 browser-extension entrypoints
src/                         extension domain, site adapters, and Community client
services/community/          self-hosted FastAPI server (AGPL-3.0-only)
services/community/core/     public contracts package (Apache-2.0)
api/openapi-v1.json          generated public API description (Apache-2.0)
```

The extension code at the repository root is licensed under MPL-2.0. See
[`LICENSES/README.md`](LICENSES/README.md) for the complete license map.

## Requirements

- Node.js 22 or later
- pnpm 11 or later
- Python 3.12 or later
- [uv](https://docs.astral.sh/uv/)
- Podman or Docker for the container workflow
- an OpenAI-compatible multimodal model endpoint

## Run the server

Copy the server environment example and fill in private values:

```bash
cp services/community/.env.example services/community/.env
```

```env
CHARTVIZ_LLM_BASE_URL=https://openrouter.ai/api/v1
CHARTVIZ_LLM_API_KEY=your-provider-key
CHARTVIZ_LLM_MODEL=openai/gpt-5.4
CHARTVIZ_LOCAL_API_TOKEN=replace-with-a-long-random-token
CHARTVIZ_DATA_DIR=/absolute/path/to/chartviz-data
```

Never put `CHARTVIZ_LLM_API_KEY` in the extension. It belongs only on the
server.

Run with uv:

```bash
uv sync --project services/community
set -a
source services/community/.env
set +a
uv run --project services/community chartviz-community
```

Or build the container:

```bash
podman build -t chartviz-community:local \
  -f services/community/Containerfile services/community

podman run --rm \
  -p 127.0.0.1:8000:8000 \
  --env-file services/community/.env \
  -v /absolute/path/to/chartviz-data:/data/chartviz:Z \
  chartviz-community:local
```

For the same loopback-only setup with a named data volume:

```bash
cp services/community/.env.example services/community/.env
podman compose up --build
```

The examples bind to loopback. Put TLS and authentication controls appropriate
for your network in front of the service before exposing it remotely.

## Install the extension

Download the archive for your browser from the
[`v1.0.0` GitHub release](https://github.com/ockevin331/chartviz-community/releases/tag/v1.0.0):

- Chrome extension: `chartviz-community-extension-v1.0.0-chrome.zip`
- Edge extension: `chartviz-community-extension-v1.0.0-edge.zip`

The browser cannot load the ZIP directly. Extract it first, then install the
unpacked directory:

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select the extracted directory that directly contains `manifest.json`.
5. Pin ChartViz Community from the browser extensions menu.
6. Open a supported chart page and open the extension.
7. Enter your Community server URL and the same `CHARTVIZ_LOCAL_API_TOKEN`
   configured on the server.

The downloaded archives include no provider API key. Keep
`CHARTVIZ_LLM_API_KEY` on the server only.

## Build the extension

Public package scripts always select Community mode:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm build:edge
pnpm zip
pnpm zip:edge
```

Load the unpacked Chrome directory below `dist/chrome` or the Edge directory
below `dist/edge`. Open a supported chart page, then enter the server URL and
the same `CHARTVIZ_LOCAL_API_TOKEN` in the extension connection panel.

The Community manifest has no Chrome identity permission and no required
ChartViz Cloud host permission. Arbitrary-host screenshot access remains an
optional permission requested only when needed.

## API

Public discovery endpoints:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/v1/capabilities
```

Create and poll one analysis:

```bash
curl -X POST http://127.0.0.1:8000/v1/analyses \
  -H "Authorization: Bearer ${CHARTVIZ_LOCAL_API_TOKEN}" \
  -F 'image=@/absolute/path/to/chart.png;type=image/png' \
  -F 'context={"language":"en","timeframe":"15m"}'

curl http://127.0.0.1:8000/v1/analyses/ANALYSIS_ID \
  -H "Authorization: Bearer ${CHARTVIZ_LOCAL_API_TOKEN}"
```

See [`api/openapi-v1.json`](api/openapi-v1.json) for the generated contract.

## Data and security

The server stores `community.sqlite3`, SQLite WAL files while running, and
uploaded images below `CHARTVIZ_DATA_DIR`. Stop the server before backup or
deletion. Resolve and verify the exact configured directory before removing
data.

Report vulnerabilities according to [`SECURITY.md`](SECURITY.md). Do not put
secrets or sensitive charts in public issues.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md), the code of conduct, and the license
map before opening a pull request.

## Disclaimer

Screenshot interpretation can be incomplete, inaccurate, or stale. ChartViz
Community is for chart research and education and is not a recommendation to
buy or sell any financial instrument.
