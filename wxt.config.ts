import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';
import { canonicalAnalysisApiBaseUrl, DEFAULT_ANALYSIS_API_BASE_URL } from './src/api/base-url';
import { editionForMode } from './src/config/edition';

const packageVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string;

// Keep the extension ID stable during local development. Chrome Web Store
// rejects uploaded packages that contain this development-only field, so
// production builds and ZIP artifacts must omit it.
const extensionPublicKey = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzxF5PLqNR/ejqzt/jOmGuG0zCQ2/09lDFDFidWIt+45EW2uPqMdL35fCK9yYY0lKYMgL1nCK0YO2Sh1B2lH84Vbdj6Hhdgu6ITVDVTlDNnFvZ/QPAN4r4DSfr47wUI0rN6B9byr5oIVUSKUBdbzmayo2Ie/KkvDI7xf/3PKVTU/5n+4TbOGFGwzkhNTkhB1rhbPEpOjV6VN//1BzJYgwkf9L1oHXykLs5W7bhqpm7AsJyXuKiKWvHux5kFlyUZX96gCWU3ns9oEpfoG3wkrfRX9yUHA9ZOKU1dr6QoyD/tnxetdesZ2e+Z2Du22vLB2T/vAzpBTtsCeVICi6razYZwIDAQAB';

const chartSiteHosts = [
  'https://*.tradingview.com/*',
  'https://*.binance.com/*',
  'https://*.okx.com/*',
  'https://*.bybit.com/*',
  'https://app.hyperliquid.xyz/*',
  'https://*.coinbase.com/*',
  'https://*.bitget.com/*',
  'https://*.gate.com/*',
  'https://*.gate.io/*',
  'https://*.kucoin.com/*',
  'https://*.mexc.com/*',
  'https://*.htx.com/*',
  'https://*.upbit.com/*',
  'https://stockpage.10jqka.com.cn/*',
  'https://vergex.trade/*',
];

const cloudHosts = [
  'https://chartviz.xyz/*',
  'https://www.chartviz.xyz/*',
];

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: 'dist',
  outDirTemplate: `{{browser}}/chartviz-v${packageVersion}-mv{{manifestVersion}}{{modeSuffix}}`,
  zip: {
    artifactTemplate: '{{browser}}/chartviz-v{{packageVersion}}{{modeSuffix}}.zip',
  },
  manifest: (env) => {
    const edition = editionForMode(env.mode);
    const isCommunity = edition === 'community';
    const analysisApiUrl = canonicalAnalysisApiBaseUrl(
      process.env.WXT_PUBLIC_ANALYSIS_API_BASE_URL ?? DEFAULT_ANALYSIS_API_BASE_URL,
    );
    const analysisApiPermission =
      process.env.WXT_PUBLIC_ANALYSIS_MODE === 'remote' && analysisApiUrl
        ? `${new URL(analysisApiUrl).origin}/*`
        : undefined;

    return {
      ...(env.mode === 'development' ? { key: extensionPublicKey } : {}),
      name: isCommunity ? 'ChartViz Community' : 'ChartViz',
      description: 'Analyze the K-line chart currently visible in your browser.',
      permissions: [
        'activeTab',
        'storage',
        'scripting',
        ...(!isCommunity ? ['identity'] : []),
      ],
      host_permissions: [
        ...chartSiteHosts,
        ...(!isCommunity ? cloudHosts : []),
        ...(!isCommunity && analysisApiPermission && !['https://www.chartviz.xyz/*'].includes(analysisApiPermission) ? [analysisApiPermission] : []),
      ],
      optional_host_permissions: ['<all_urls>'],
      action: {
        default_title: 'Show or hide ChartViz',
        default_icon: {
          16: 'icons/chartviz-16.png',
          32: 'icons/chartviz-32.png',
          48: 'icons/chartviz-48.png',
          128: 'icons/chartviz-128.png',
        },
      },
      icons: {
        16: 'icons/chartviz-16.png',
        32: 'icons/chartviz-32.png',
        48: 'icons/chartviz-48.png',
        128: 'icons/chartviz-128.png',
      },
      web_accessible_resources: [
        {
          resources: ['floating-panel.html', 'chunks/*', 'assets/*', 'icons/*'],
          matches: ['https://*.tradingview.com/*', 'https://*.binance.com/*', 'https://*.okx.com/*', 'https://*.bybit.com/*', 'https://app.hyperliquid.xyz/*', 'https://*.coinbase.com/*', 'https://*.bitget.com/*', 'https://*.gate.com/*', 'https://*.gate.io/*', 'https://*.kucoin.com/*', 'https://*.mexc.com/*', 'https://*.htx.com/*', 'https://*.upbit.com/*', 'https://stockpage.10jqka.com.cn/*', 'https://vergex.trade/*'],
        },
      ],
    };
  },
});
