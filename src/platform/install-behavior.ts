import type { ExtensionEdition } from '../config/edition';

export type InstallAction =
  | { kind: 'none' }
  | { kind: 'open-tab'; url: string };

export function installAction(
  edition: ExtensionEdition,
  language: 'en' | 'zh-CN',
): InstallAction {
  if (edition === 'community') return { kind: 'none' };
  const url = new URL('https://www.chartviz.xyz/');
  url.searchParams.set('source', 'extension-install');
  url.searchParams.set('language', language);
  return { kind: 'open-tab', url: url.toString() };
}
