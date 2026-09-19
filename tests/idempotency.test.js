const { IdempotencyGuard } = require('../src/executor/idempotency');

describe('IdempotencyGuard', () => {
  test('runs fn once and returns its result', async () => {
    const guard = new IdempotencyGuard();
    const result = await guard.execute('key-1', async () => 'result-1');
    expect(result).toBe('result-1');
  });

  test('a repeated key returns the same settled result without re-running fn', async () => {
    const guard = new IdempotencyGuard();
    const fn = jest.fn().mockResolvedValue('only-once');

    const first = await guard.execute('key-1', fn);
    const second = await guard.execute('key-1', fn);

    expect(first).toBe('only-once');
    expect(second).toBe('only-once');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('concurrent calls with the same key dedupe to a single in-flight execution', async () => {
    const guard = new IdempotencyGuard();
    let callCount = 0;
    const fn = () =>
      new Promise((resolve) => {
        callCount += 1;
        setTimeout(() => resolve('concurrent-result'), 50);
      });

    const [a, b] = await Promise.all([guard.execute('key-1', fn), guard.execute('key-1', fn)]);

    expect(a).toBe('concurrent-result');
    expect(b).toBe('concurrent-result');
    expect(callCount).toBe(1);
  });

  test('different keys run independently', async () => {
    const guard = new IdempotencyGuard();
    const a = await guard.execute('key-A', async () => 'A');
    const b = await guard.execute('key-B', async () => 'B');
    expect(a).toBe('A');
    expect(b).toBe('B');
  });

  test('a failed run clears the key so a later retry can run fn again', async () => {
    const guard = new IdempotencyGuard();
    const fn = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('recovered');

    await expect(guard.execute('key-1', fn)).rejects.toThrow('boom');
    expect(guard.has('key-1')).toBe(false);

    const result = await guard.execute('key-1', fn);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
