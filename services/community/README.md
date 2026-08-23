# ChartViz Community

ChartViz Community is a self-hosted baseline for educational candlestick-chart
interpretation. It accepts one chart screenshot, calls one OpenAI-compatible
multimodal model with your API key, validates the structured response, and
stores the task and report locally.

It is not the production ChartViz Cloud analysis engine and it does not place
trades or provide personalized investment advice.

## Community and Cloud

| Capability | Community | ChartViz Cloud |
| --- | --- | --- |
| Screenshot inputs | One | One to three |
| Timeframes | One | Single and multi-timeframe |
| Model cost | Bring your own key | Included according to plan quota |
| Analysis pipeline | One multimodal request | Evidence extraction, data fusion, reasoning, and risk checks |
| Exchange OHLCV and indicators | No | Supported exchanges |
| Authentication | Local static token | ChartViz account and extension authorization |
| Storage | SQLite and local files | Managed production storage |

## Security model

Provider credentials stay on the Community server. Do not place an LLM API key
inside a browser extension. Protect the API with a random
`CHARTVIZ_LOCAL_API_TOKEN`, bind it to a trusted interface, and put TLS in front
of it before allowing access from another machine.

The server stores its SQLite database and uploaded screenshots below
`CHARTVIZ_DATA_DIR`. Back up or delete that directory according to your data
retention requirements.

## Configuration

Copy `.env.example` to a private environment file and set all values:

```env
CHARTVIZ_LLM_BASE_URL=https://openrouter.ai/api/v1
CHARTVIZ_LLM_API_KEY=
CHARTVIZ_LLM_MODEL=openai/gpt-5.4
CHARTVIZ_LOCAL_API_TOKEN=replace-with-a-long-random-token
CHARTVIZ_DATA_DIR=/absolute/path/to/chartviz-data
```

Set `CHARTVIZ_LLM_API_KEY` in your private environment file before starting the
server; never commit that populated file.

The model provider must expose an OpenAI-compatible
`/chat/completions` endpoint and support image inputs plus strict JSON Schema
responses.

## Run with uv

```bash
uv sync --project services/community
set -a
source services/community/.env
set +a
uv run --project services/community chartviz-community
```

The packaged command binds to port `8000`; use firewall and reverse-proxy rules
appropriate for the machine. The examples access it through
`http://127.0.0.1:8000`.

## Run with Podman

```bash
podman build \
  -t chartviz-community:local \
  -f services/community/Containerfile \
  services/community

podman run --rm \
  -p 127.0.0.1:8000:8000 \
  --env-file /absolute/path/to/community.env \
  -v /absolute/path/to/chartviz-data:/data/chartviz:Z \
  chartviz-community:local
```

## Connect the ChartViz Community extension

From the repository root, build the Community browser extension separately:

```bash
pnpm install
pnpm build:community
```

Load `dist/chrome/chartviz-v1.0.0-mv3-community` as an unpacked extension, open
a supported chart page, and enter `http://127.0.0.1:8000` plus the same
`CHARTVIZ_LOCAL_API_TOKEN` used by the server. The extension verifies public
capabilities and the authenticated model catalog before saving the connection.
The provider key remains on this server and must never be copied into the
extension.

## API

Health and capability discovery are public:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/v1/capabilities
```

Create an analysis with one screenshot and one optional timeframe:

```bash
curl -X POST http://127.0.0.1:8000/v1/analyses \
  -H "Authorization: Bearer ${CHARTVIZ_LOCAL_API_TOKEN}" \
  -F 'image=@/absolute/path/to/chart.png;type=image/png' \
  -F 'context={"language":"en","timeframe":"15m"}'
```

Poll or cancel the returned analysis ID:

```bash
curl http://127.0.0.1:8000/v1/analyses/ANALYSIS_ID \
  -H "Authorization: Bearer ${CHARTVIZ_LOCAL_API_TOKEN}"

curl -X DELETE http://127.0.0.1:8000/v1/analyses/ANALYSIS_ID \
  -H "Authorization: Bearer ${CHARTVIZ_LOCAL_API_TOKEN}"
```

Community intentionally rejects multiple image parts or more than one
timeframe. ChartViz Cloud provides multi-timeframe analysis, market-data
cross-validation, advanced annotations, accounts, and managed operations.

## Data backup and deletion

Stop the server before copying the data directory. It contains
`community.sqlite3`, SQLite WAL files while running, and original images below
`images/`. To permanently remove local Community data, stop the service and
remove only the exact directory configured as `CHARTVIZ_DATA_DIR` after
verifying that path.

## Disclaimer

Screenshot interpretation can be incomplete, inaccurate, or stale. ChartViz
Community is for chart research and education and does not constitute
personalized investment advice or a recommendation to buy or sell any
financial instrument.
