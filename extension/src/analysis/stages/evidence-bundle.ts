import type { CommunitySignalFacts } from './signal-facts';
import type { CommunityVisualFacts } from './visual-facts';

export type CommunityEvidenceBundle = {
  schemaVersion: 'community-evidence-1.0';
  visualFacts: CommunityVisualFacts;
  signalFacts: CommunitySignalFacts;
};

export function mergeCommunityEvidence(
  facts: CommunityVisualFacts,
  signals: CommunitySignalFacts,
): CommunityEvidenceBundle {
  return {
    schemaVersion: 'community-evidence-1.0',
    visualFacts: structuredClone(facts),
    signalFacts: structuredClone(signals),
  };
}
