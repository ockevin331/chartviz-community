export type CloudAvailability = Readonly<{
  available: false;
  code: 'cloud_not_available';
}>;

export interface CloudAnalysisGateway {
  availability(): CloudAvailability;
}

export const unavailableCloudGateway: CloudAnalysisGateway = Object.freeze({
  availability: (): CloudAvailability => ({ available: false, code: 'cloud_not_available' }),
});
