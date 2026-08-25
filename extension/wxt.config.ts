import { defineConfig } from 'wxt';

const approvedPermissions = ['activeTab', 'storage', 'scripting'];
const approvedOrigins = [
  'https://openrouter.ai/api/*',
  'https://api.openai.com/v1/*',
  'https://generativelanguage.googleapis.com/*',
];

export type ExtensionManifest = {
  name: string;
  description: string;
  version: string;
  permissions: string[];
  host_permissions: string[];
  optional_host_permissions?: undefined;
  action: { default_popup: string; default_icon: Record<number, string> };
  icons: Record<number, string>;
};

export function createManifest(): ExtensionManifest {
  return {
    name: 'ChartViz Community',
    description: 'Chart education in your browser.',
    version: '0.1.0',
    permissions: [...approvedPermissions],
    host_permissions: [...approvedOrigins],
    action: {
      default_popup: 'panel/index.html',
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
  };
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: createManifest(),
});
