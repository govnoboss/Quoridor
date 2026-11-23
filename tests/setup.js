// Server integration tests exercise our lifecycle, not Sentry's process-global
// instrumentation. Isolate the SDK to avoid shared globals across Jest VMs.
jest.mock('@sentry/node', () => ({ init: jest.fn(), setupExpressErrorHandler: jest.fn() }));
