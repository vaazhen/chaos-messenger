import { describe, it, expect, vi, beforeEach } from 'vitest';

function simpleHash(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  let h = 0;
  for (let i = 0; i < bytes.length; i++) {
    h = ((h << 5) - h + bytes[i]) | 0;
  }
  const hash = new ArrayBuffer(32);
  const view = new Uint8Array(hash);
  for (let i = 0; i < 32; i++) {
    view[i] = (h + i * 17) & 0xFF;
  }
  return hash;
}

const mockCrypto = {
  subtle: {
    digest: vi.fn(async (_algorithm, data) => simpleHash(data)),
  },
};

beforeEach(() => {
  vi.stubGlobal('crypto', mockCrypto);
});

describe('computeSafetyNumber', () => {
  it('returns fingerprint with words, hex, and numeric blocks', async () => {
    const mod = await import('../safety-number');
    const result = await mod.computeSafetyNumber('AABBCC', 'DDEEFF');

    expect(result).toHaveProperty('fingerprint');
    expect(result).toHaveProperty('wordList');
    expect(result).toHaveProperty('hexList');
    expect(result).toHaveProperty('numericBlocks');
    expect(result).toHaveProperty('bytes');
    expect(result.wordList.length).toBe(12);
    expect(result.hexList.length).toBe(6);
    expect(result.numericBlocks.length).toBe(3);
  });

  it('produces same result for same keys regardless of order', async () => {
    const mod = await import('../safety-number');
    const result1 = await mod.computeSafetyNumber('keyA', 'keyB');
    const result2 = await mod.computeSafetyNumber('keyB', 'keyA');

    expect(result1.fingerprint).toBe(result2.fingerprint);
    expect(result1.wordList).toEqual(result2.wordList);
    expect(result1.bytes).toEqual(result2.bytes);
  });

  it('changes the contact fingerprint when a second device key is added', async () => {
    const mod = await import('../safety-number');
    const one = await mod.computeContactSafetyNumber('own', ['device-a']);
    const two = await mod.computeContactSafetyNumber('own', ['device-a', 'device-b']);
    expect(one.fingerprint).not.toBe(two.fingerprint);
  });
});

describe('formatSafetyNumber', () => {
  it('formats all representations', async () => {
    const mod = await import('../safety-number');
    const safety = await mod.computeSafetyNumber('test', 'keys');

    const formatted = mod.formatSafetyNumber(safety);

    expect(formatted).toHaveProperty('numeric');
    expect(formatted).toHaveProperty('hex');
    expect(formatted).toHaveProperty('words');
    expect(typeof formatted.numeric).toBe('string');
    expect(typeof formatted.hex).toBe('string');
    expect(typeof formatted.words).toBe('string');
  });
});

describe('areSafetyNumbersEqual', () => {
  it('returns true for identical safety numbers', async () => {
    const mod = await import('../safety-number');
    const a = await mod.computeSafetyNumber('keyA', 'keyB');
    const b = await mod.computeSafetyNumber('keyA', 'keyB');

    expect(mod.areSafetyNumbersEqual(a, b)).toBe(true);
  });

  it('returns false if either is null', async () => {
    const mod = await import('../safety-number');
    expect(mod.areSafetyNumbersEqual(null, null)).toBe(false);
    const a = await mod.computeSafetyNumber('a', 'b');
    expect(mod.areSafetyNumbersEqual(a, null)).toBe(false);
    expect(mod.areSafetyNumbersEqual(null, a)).toBe(false);
  });

  it('recognizes self-equality on fingerprint string', async () => {
    const mod = await import('../safety-number');
    const a = await mod.computeSafetyNumber('x', 'y');
    const b = await mod.computeSafetyNumber('x', 'y');
    expect(mod.areSafetyNumbersEqual(a, b)).toBe(true);
  });
});
