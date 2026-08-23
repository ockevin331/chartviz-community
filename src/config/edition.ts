export type ExtensionEdition = 'cloud' | 'community';

export function editionForMode(mode: string | undefined): ExtensionEdition {
  return mode === 'community' ? 'community' : 'cloud';
}

export const EXTENSION_EDITION = editionForMode(import.meta.env.MODE);
