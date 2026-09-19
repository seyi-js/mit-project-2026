const { createSingleProviderStrategy } = require('../src/planner/strategies/singleProviderStrategy');

describe('single-provider strategy', () => {
  test('always selects the fixed provider on the first attempt', async () => {
    const strategy = createSingleProviderStrategy({ providerId: 'B' });
    expect(await strategy.selectProvider({ attemptNumber: 1, excludedProviders: [] })).toBe('B');
  });

  test('defaults to provider A when none is configured', async () => {
    const strategy = createSingleProviderStrategy();
    expect(await strategy.selectProvider({ attemptNumber: 1, excludedProviders: [] })).toBe('A');
  });

  test('never falls back on a second attempt', async () => {
    const strategy = createSingleProviderStrategy({ providerId: 'A' });
    expect(await strategy.selectProvider({ attemptNumber: 2, excludedProviders: ['A'] })).toBeNull();
  });
});
