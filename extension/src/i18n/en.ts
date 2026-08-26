export const en = {
  slogan: 'Instant pattern intelligence – wherever you trade.',
  language: 'Language', close: 'Close', providerSetup: 'Provider setup', providerSetupHelp: 'Connect a vision-capable model with your own API key.',
  provider: 'Provider', model: 'Model', apiKey: 'API key', showApiKey: 'Show API key', hideApiKey: 'Hide API key', customModel: 'Use a custom model', customModelId: 'Custom model ID',
  multimodalWarning: 'Custom models must support image input. Text-only models cannot analyze chart screenshots.', multimodalAck: 'I confirm this model supports image input.',
  connectionCost: 'Testing the connection sends a provider request and may incur a small charge.', testConnection: 'Test connection', testingConnection: 'Testing…', connectionOk: 'Connection successful.', saveContinue: 'Save and continue',
  invalid_config: 'Check the API key and model.', invalid_api_key: 'The API key is invalid.', model_not_found: 'The selected model was not found.', model_not_multimodal: 'The selected model does not support image input.', insufficient_balance: 'The provider account has insufficient balance.', rate_limited: 'The provider rate limit was reached.', invalid_image: 'The chart image could not be read.', network_timeout: 'The provider request timed out.', invalid_response: 'The provider returned an invalid report.', cancelled: 'Analysis cancelled.', unknownError: 'Something went wrong.',
  chooseImage: 'Choose chart image', chooseImageHelp: 'Analyze one visible TradingView chart or upload one PNG, JPEG, or WebP image.', capture: 'Capture visible TradingView chart', upload: 'Upload one chart image', sourceError: 'Unable to read this image.',
  preview: 'Screenshot preview', previewAlt: 'Chart ready for analysis', changeImage: 'Choose another image', analyze: 'Analyze screenshot', cancel: 'Cancel analysis', backPreview: 'Back to preview', retry: 'Try again',
  reading_chart: 'Reading chart', organizing_evidence: 'Organizing evidence', preparing_result: 'Preparing result',
  original: 'Original screenshot', zoom: 'Zoom', download: 'Download image', copyReport: 'Copy report', copied: 'Copied',
  chart: 'Chart', instrument: 'Instrument', timeframe: 'Timeframe', limitations: 'Limitations', marketView: 'Market view', bias: 'Bias', phase: 'Phase', strength: 'Strength', evidence: 'Evidence', observation: 'Observation', implication: 'Implication', visibleAt: 'Visible at', confidence: 'Confidence', volume: 'Volume', indicators: 'Indicators', supportResistance: 'Support and resistance', reason: 'Reason', scenarios: 'Scenarios', long: 'Long', short: 'Short', wait: 'Wait', condition: 'Condition', entry: 'Entry', stop: 'Stop', targets: 'Targets', patterns: 'Chart patterns', status: 'Status', timeRange: 'Visible range', signals: 'Trade signals', direction: 'Direction', riskReward: 'Risk/reward', riskNotice: 'Risk notice', none: 'None',
} as const;

export type TranslationKey = keyof typeof en;
