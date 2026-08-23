import type { BackendCapabilities } from '../api/backend-capabilities';
import type { ExtensionEdition } from '../config/edition';

export type ExtensionFeatures = {
  cloudAccount: boolean;
  billing: boolean;
  modelSelection: boolean;
  analysisList: boolean;
  multiTimeframe: boolean;
  advancedAnnotations: boolean;
};

export function deriveExtensionFeatures(
  edition: ExtensionEdition,
  capabilities: BackendCapabilities,
): ExtensionFeatures {
  if (edition !== capabilities.edition) throw new Error('unexpected_backend_edition');
  const cloudAccount = edition === 'cloud' && capabilities.features.cloudAuthentication;
  return {
    cloudAccount,
    billing: cloudAccount && capabilities.features.billing,
    modelSelection: cloudAccount,
    analysisList: cloudAccount,
    multiTimeframe:
      capabilities.features.multiTimeframe
      && capabilities.limits.maxTimeframes > 1,
    advancedAnnotations: capabilities.features.advancedAnnotations,
  };
}
