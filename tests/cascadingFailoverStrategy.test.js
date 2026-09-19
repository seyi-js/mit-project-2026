const { createCascadingFailoverStrategy } = require('../src/planner/strategies/cascadingFailoverStrategy');

describe('cascading-failover strategy', () => {
  test('always attempts A first, regardless of any observed behaviour', async () => {
    const strategy = createCascadingFailoverStrategy();
    expect(await strategy.selectProvider({ attemptNumber: 1, excludedProviders: [] })).toBe('A');
  });

  test('falls back to B, then C, in fixed order', async () => {
    const strategy = createCascadingFailoverStrategy();
    expect(await strategy.selectProvider({ attemptNumber: 2, excludedProviders: ['A'] })).toBe('B');
    expect(await strategy.selectProvider({ attemptNumber: 3, excludedProviders: ['A', 'B'] })).toBe('C');
  });

  test('stops after the shared max-attempts cap (3)', async () => {
    const strategy = createCascadingFailoverStrategy();
    expect(await strategy.selectProvider({ attemptNumber: 4, excludedProviders: ['A', 'B', 'C'] })).toBeNull();
  });

  test('stops once all providers are exhausted even under a custom order', async () => {
    const strategy = createCascadingFailoverStrategy({ order: ['B', 'C', 'A'] });
    expect(await strategy.selectProvider({ attemptNumber: 1, excludedProviders: [] })).toBe('B');
    expect(await strategy.selectProvider({ attemptNumber: 2, excludedProviders: ['B'] })).toBe('C');
    expect(await strategy.selectProvider({ attemptNumber: 3, excludedProviders: ['B', 'C'] })).toBe('A');
  });
});
