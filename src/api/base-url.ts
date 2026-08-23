export const DEFAULT_ANALYSIS_API_BASE_URL = 'https://www.chartviz.xyz/api';

const LEGACY_PRODUCTION_HOSTS = new Set([
  'chartviz.xyz',
]);
const RETIRED_PRODUCTION_HOSTS = new Set([
  `chartviz.${'octopus31.com'}`,
]);

export function canonicalAnalysisApiBaseUrl(
  configured = DEFAULT_ANALYSIS_API_BASE_URL,
): string {
  const url = new URL(configured);
  if (RETIRED_PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('The configured ChartViz API host has been retired.');
  }
  if (LEGACY_PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) {
    url.protocol = 'https:';
    url.hostname = 'www.chartviz.xyz';
    url.port = '';
  }
  return url.toString().replace(/\/$/, '');
}
