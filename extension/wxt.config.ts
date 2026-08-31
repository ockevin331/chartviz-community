import { defineConfig } from 'wxt';
import { supportedChartHosts } from './src/sites/supported-sites';

const approvedPermissions = ['activeTab', 'storage', 'scripting', 'clipboardWrite'];
export const approvedProviderOrigins = [
  'https://openrouter.ai/api/*',
  'https://api.openai.com/v1/*',
  'https://generativelanguage.googleapis.com/*',
] as const;

export const approvedCloudOrigin = 'https://www.chartviz.xyz/*' as const;
export const approvedCaptureOrigin = '<all_urls>' as const;

export const approvedHostPermissions = [
  approvedCaptureOrigin,
  ...approvedProviderOrigins,
  approvedCloudOrigin,
  ...supportedChartHosts,
];

export type ExtensionManifest = {
  name: string;
  description: string;
  version: string;
  permissions: string[];
  host_permissions: string[];
  optional_host_permissions?: undefined;
  content_security_policy: { extension_pages: string };
  action: { default_popup?: undefined; default_icon: Record<number, string> };
  icons: Record<number, string>;
  web_accessible_resources: Array<{
    resources: string[];
    matches: string[];
    use_dynamic_url: true;
  }>;
};

export function createManifest(): ExtensionManifest {
  return {
    name: 'ChartViz',
    description: 'Chart education in your browser.',
    version: '1.0.6',
    permissions: [...approvedPermissions],
    host_permissions: [...approvedHostPermissions],
    action: {
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
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
    },
    web_accessible_resources: [{
      resources: ['panel.html', 'chunks/*', 'assets/*'],
      matches: ['http://*/*', 'https://*/*'],
      use_dynamic_url: true,
    }],
  };
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: createManifest(),
});
