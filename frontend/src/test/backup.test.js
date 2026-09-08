import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCrypto = {
  getRandomValues: vi.fn((arr) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
    return arr;
  }),
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000000'),
  subtle: {
    importKey: vi.fn(() => Promise.resolve('mockKey')),
    deriveKey: vi.fn(() => Promise.resolve('mockEncKey')),
    encrypt: vi.fn(() => {
      const buf = new ArrayBuffer(64);
      const view = new Uint8Array(buf);
      for (let i = 0; i < 64; i++) view[i] = i;
      return Promise.resolve(buf);
    }),
        decrypt: vi.fn(() => {
      const plaintext = JSON.stringify({
        version: 2,
        deviceId: 'test-device',
        registrationId: '42',
        identityKeyPair: JSON.stringify({ publicKey: 'id-pub', privateKeyPkcs8: 'id-priv' }),
        signingKeyPair: JSON.stringify({ publicKeySpki: 'sig-pub', privateKeyPkcs8: 'sig-priv' }),
        consumedPreKeyIds: JSON.stringify([1001]),
      });
      return Promise.resolve(new TextEncoder().encode(plaintext));
    }),
    digest: vi.fn(() => {
      const hash = new ArrayBuffer(32);
      const view = new Uint8Array(hash);
      for (let i = 0; i < 32; i++) view[i] = i;
      return Promise.resolve(hash);
    }),
  },
};

const mockBundle = {
  deviceId: 'test-device',
  registrationId: 42,
  identity: { publicKey: 'id-pub', privateKeyPkcs8: 'id-priv' },
  signingKey: { publicKeySpki: 'sig-pub', privateKeyPkcs8: 'sig-priv' },
  signedPreKey: { preKeyId: 1, publicKey: 'spk-pub', privateKeyPkcs8: 'spk-priv', signature: 'spk-sig' },
  oneTimePreKeys: [{ preKeyId: 1000, publicKey: 'otp-pub', privateKeyPkcs8: 'otp-priv' }],
};

beforeEach(() => {
  vi.resetModules();
  mockCrypto.subtle.decrypt.mockClear();
  vi.stubGlobal('crypto', mockCrypto);
  vi.stubGlobal('btoa', vi.fn((s) => Buffer.from(s, 'binary').toString('base64')));
  vi.stubGlobal('atob', vi.fn((s) => Buffer.from(s, 'base64').toString('binary')));
  localStorage.clear();
  delete window.e2ee;
});

describe('createEncryptedBackup', () => {
  it('throws if crypto engine not loaded', async () => {
    const mod = await import('../backup');
    await expect(mod.createEncryptedBackup('pass')).rejects.toThrow('Crypto engine not loaded');
  });

  it('throws if no local keys found', async () => {
    window.e2ee = { getLocalDeviceBundle: vi.fn(() => null) };
    const mod = await import('../backup');
    await expect(mod.createEncryptedBackup('pass')).rejects.toThrow('No local keys found');
  });

  it('returns encrypted payload when keys are present', async () => {
    window.e2ee = { getLocalDeviceBundle: vi.fn(() => mockBundle) };
    const mod = await import('../backup');
    const result = await mod.createEncryptedBackup('test-passphrase');
    expect(result).toEqual(expect.objectContaining({
      encryptedPayload: expect.any(String),
      salt: expect.any(String),
      iv: expect.any(String),
      checksum: expect.any(String),
    }));
    expect(mockCrypto.subtle.deriveKey).toHaveBeenCalled();
    expect(mockCrypto.subtle.encrypt).toHaveBeenCalled();
  });
});

describe('decryptBackup', () => {
  it('decrypts and parses backup data', async () => {
    const mod = await import('../backup');
    const result = await mod.decryptBackup(
      Buffer.from('encrypted').toString('base64'),
      Buffer.from('salt123456789012345678901234567890').toString('base64'),
      Buffer.from('iv1234567890').toString('base64'),
      'test-passphrase'
    );
    expect(result).toEqual(expect.objectContaining({ version: 2, deviceId: 'test-device' }));
    expect(mockCrypto.subtle.decrypt).toHaveBeenCalled();
  });

  it("rejects a backup whose checksum does not match the payload", async () => {
    const mod = await import("../backup");
    await expect(mod.decryptBackup(
      Buffer.from("encrypted").toString("base64"),
      Buffer.from("salt123456789012345678901234567890").toString("base64"),
      Buffer.from("iv1234567890").toString("base64"),
      "test-passphrase",
      "not-the-real-checksum",
    )).rejects.toThrow("Backup checksum mismatch");
    expect(mockCrypto.subtle.decrypt).not.toHaveBeenCalled();
  });
});

describe('restoreKeysFromBackup', () => {
  it('imports identity material through secure storage and regenerates pre-keys', async () => {
    const importLocalDeviceBundle = vi.fn().mockResolvedValue('restored-device');
    window.e2ee = { importLocalDeviceBundle };
    const mod = await import('../backup');
    const backupData = {
      deviceId: 'restored-device',
      registrationId: '99',
      identityKeyPair: JSON.stringify({ publicKey: 'id-pub', privateKeyPkcs8: 'id-priv' }),
      signingKeyPair: JSON.stringify({ publicKeySpki: 'sig-pub', privateKeyPkcs8: 'sig-priv' }),
      signedPreKey: JSON.stringify({ preKeyId: 1, publicKey: 'spk-pub', privateKeyPkcs8: 'spk-priv', signature: 'spk-sig' }),
      oneTimePreKeys: JSON.stringify([{ preKeyId: 1000, publicKey: 'otp-pub', privateKeyPkcs8: 'otp-priv' }]),
      consumedPreKeyIds: JSON.stringify([1000]),
    };

    await expect(mod.restoreKeysFromBackup(backupData)).resolves.toEqual({
      restored: true,
      deviceId: 'restored-device',
    });

    expect(importLocalDeviceBundle).toHaveBeenCalledWith({
      deviceId: 'restored-device',
      registrationId: 99,
      identity: { publicKey: 'id-pub', privateKeyPkcs8: 'id-priv' },
      signingKey: { publicKeySpki: 'sig-pub', privateKeyPkcs8: 'sig-priv' },
      signedPreKey: null,
      oneTimePreKeys: [],
      consumedPreKeyIds: [1000],
    });
    expect(localStorage.getItem('cm_device_bundle_v2')).toBeNull();
    expect(localStorage.getItem('chaos_identityKeyPair')).toBeNull();
    expect(localStorage.getItem('chaos_backupRestored')).toBe('true');
  });

  it('rejects partial backups without a signing key', async () => {
    window.e2ee = { importLocalDeviceBundle: vi.fn() };
    const mod = await import('../backup');
    await expect(mod.restoreKeysFromBackup({
      deviceId: 'partial-device',
      identityKeyPair: JSON.stringify({ publicKey: 'id-pub', privateKeyPkcs8: 'id-priv' }),
    })).rejects.toThrow('Backup is missing the signing key');
  });

  it('rejects partial backups without an identity key pair', async () => {
    window.e2ee = { importLocalDeviceBundle: vi.fn() };
    const mod = await import('../backup');
    await expect(mod.restoreKeysFromBackup({ deviceId: 'partial-device' }))
      .rejects.toThrow('Backup is missing the device identity');
  });
});
