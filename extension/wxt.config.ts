import { defineConfig } from 'wxt';

const approvedPermissions = ['activeTab', 'storage', 'scripting'];

export type ExtensionManifest = {
  name: string;
  description: string;
  version: string;
  permissions: string[];
  host_permissions?: undefined;
  optional_host_permissions?: undefined;
  content_scripts?: undefined;
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
    name: 'ChartViz Community',
    description: 'Chart education in your browser.',
    version: '0.1.0',
    permissions: [...approvedPermissions],
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
    web_accessible_resources: [{
      resources: ['panel.html'],
      matches: ['http://*/*', 'https://*/*'],
      use_dynamic_url: true,
    }],
  };
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: createManifest(),
});
