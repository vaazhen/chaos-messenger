import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

async function loadCryptoEngine() {
  vi.resetModules();
  return import("../crypto-engine.ts");
}

function bytesToB64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function clearCryptoTestState() {
  localStorage.clear();
  sessionStorage.clear();
  delete window.e2ee;
  delete globalThis.__chaosSecureStorageMemoryV1;
}

async function activateDevice(bundle, sessions = {}) {
  await window.e2ee.importLocalDeviceBundle(bundle);
  await window.e2ee.__importSessionStateForTests(sessions);
}

function getSessions() {
  return window.e2ee.__exportSessionStateForTests();
}

async function genDevice(deviceId) {
  const identityKey = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const signedPreKey = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const signingKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

  const identityPub = new Uint8Array(await crypto.subtle.exportKey("raw", identityKey.publicKey));
  const identityPriv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", identityKey.privateKey));
  const spkPub = new Uint8Array(await crypto.subtle.exportKey("raw", signedPreKey.publicKey));
  const spkPriv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", signedPreKey.privateKey));
  const signingPub = new Uint8Array(await crypto.subtle.exportKey("spki", signingKey.publicKey));
  const signingPriv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", signingKey.privateKey));
  const spkSig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey.privateKey, spkPub),
  );
  const otk = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const otkPub = new Uint8Array(await crypto.subtle.exportKey("raw", otk.publicKey));
  const otkPriv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", otk.privateKey));

  return {
    deviceId,
    registrationId: 1,
    identity: { publicKey: bytesToB64(identityPub), privateKeyPkcs8: bytesToB64(identityPriv) },
    signingKey: { publicKeySpki: bytesToB64(signingPub), privateKeyPkcs8: bytesToB64(signingPriv) },
    signedPreKey: {
      preKeyId: 1,
      publicKey: bytesToB64(spkPub),
      privateKeyPkcs8: bytesToB64(spkPriv),
      signature: bytesToB64(spkSig),
      createdAt: Date.now(),
    },
    oneTimePreKeys: [{ preKeyId: 1001, publicKey: bytesToB64(otkPub), privateKeyPkcs8: bytesToB64(otkPriv) }],
  };
}

function makeApi(targetBundle, extraDevices = []) {
  const oneTimePreKey = targetBundle.oneTimePreKeys?.[0]
    ? { preKeyId: targetBundle.oneTimePreKeys[0].preKeyId, publicKey: targetBundle.oneTimePreKeys[0].publicKey }
    : null;
  return vi.fn(async (path) => {
    if (path.includes("resolve-chat-devices")) {
      return {
        targetDevices: [
          {
            userId: 42,
            deviceId: targetBundle.deviceId,
            identityPublicKey: targetBundle.identity.publicKey,
            signingPublicKey: targetBundle.signingKey.publicKeySpki,
            signedPreKey: targetBundle.signedPreKey,
            oneTimePreKey: null,
          },
          ...extraDevices,
        ],
      };
    }
    if (path.includes("reserve-prekey")) {
      const wanted = decodeURIComponent(path.split("/devices/")[1].split("/")[0]);
      const extra = extraDevices.find((d) => d.deviceId === wanted);
      if (extra) return { signedPreKey: extra.signedPreKey, oneTimePreKey: extra._reserveOtk };
      return { signedPreKey: targetBundle.signedPreKey, oneTimePreKey };
    }
    return {};
  });
}

describe("legacy SELF_WHISPER decoder is gone", () => {
  beforeEach(() => {
    clearCryptoTestState();
    vi.stubGlobal("indexedDB", undefined);
  });

  it("rejects a static-key self envelope with no ratchet public key", async () => {
    await loadCryptoEngine();
    const victim = await genDevice("device-victim");
    await activateDevice(victim);

    await expect(window.e2ee.decryptEnvelope({
      messageType: "SELF_WHISPER",
      senderDeviceId: victim.deviceId,
      ciphertext: "AAAA",
      nonce: "AAAA",
      _chatId: 777,
    })).rejects.toThrow("SELF_WHISPER requires a ratchet session");
  }, 30000);
});

describe("UNVERIFIED_DEVICE does not trust server userId grouping", () => {
  let Alice;
  let Bob;
  let Mallory;

  beforeAll(async () => {
    Alice = await genDevice("device-alice");
    Bob = await genDevice("device-bob");
    Mallory = await genDevice("device-mallory");
  }, 60000);

  beforeEach(() => {
    clearCryptoTestState();
    vi.stubGlobal("indexedDB", undefined);
  });

  function malloryTarget(userId) {
    return {
      userId,
      deviceId: Mallory.deviceId,
      identityPublicKey: Mallory.identity.publicKey,
      signingPublicKey: Mallory.signingKey.publicKeySpki,
      signedPreKey: Mallory.signedPreKey,
      oneTimePreKey: null,
      _reserveOtk: {
        preKeyId: Mallory.oneTimePreKeys[0].preKeyId,
        publicKey: Mallory.oneTimePreKeys[0].publicKey,
      },
    };
  }

  it("blocks an injected device even when the server relabels its userId", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    await window.e2ee.verifyRemoteIdentity(Bob.deviceId, Bob.identity.publicKey, "SAFETY_NUMBER");

    await expect(
      window.e2ee.buildFanoutRequest(makeApi(Bob, [malloryTarget(43)]), 100, "secret"),
    ).rejects.toThrow(`UNVERIFIED_DEVICE:${Mallory.deviceId}`);
  }, 30000);

  it("blocks an injected device labelled as the sender's own extra device", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    await window.e2ee.verifyRemoteIdentity(Bob.deviceId, Bob.identity.publicKey, "SAFETY_NUMBER");

    const api = vi.fn(async (path) => {
      if (path.includes("resolve-chat-devices")) {
        return {
          targetDevices: [
            { userId: 7, deviceId: Alice.deviceId, identityPublicKey: Alice.identity.publicKey },
            {
              userId: 42,
              deviceId: Bob.deviceId,
              identityPublicKey: Bob.identity.publicKey,
              signingPublicKey: Bob.signingKey.publicKeySpki,
              signedPreKey: Bob.signedPreKey,
            },
            malloryTarget(7),
          ],
        };
      }
      if (path.includes("prekeys")) return { available: 50 };
      return {};
    });

    await expect(window.e2ee.buildFanoutRequest(api, 100, "secret for my own devices"))
      .rejects.toThrow(`UNVERIFIED_DEVICE:${Mallory.deviceId}`);
  }, 30000);
});

describe("identity-only backup cannot decrypt retained ciphertext", () => {
  let Alice;
  let Bob;

  beforeAll(async () => {
    Alice = await genDevice("device-alice-b");
    Bob = await genDevice("device-bob-b");
  }, 60000);

  beforeEach(() => {
    clearCryptoTestState();
    vi.stubGlobal("indexedDB", undefined);
  });

  it("restore does not import signed pre-key or OTK private keys", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const captured = [];
    for (let i = 0; i < 2; i++) {
      const fanout = await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, `secret-${i}`);
      captured.push(fanout.envelopes[0]);
    }

    const { createEncryptedBackup, decryptBackup, restoreKeysFromBackup } = await import("../backup.js");
    clearCryptoTestState();
    await loadCryptoEngine();
    await activateDevice(Bob);
    const blob = await createEncryptedBackup("correct horse battery staple");
    const parsed = await decryptBackup(blob.encryptedPayload, blob.salt, blob.iv, "correct horse battery staple", blob.checksum);
    expect(parsed.signedPreKey).toBeUndefined();
    expect(parsed.oneTimePreKeys).toBeUndefined();
    expect(parsed.identityKeyPair).toBeTruthy();
    expect(parsed.signingKeyPair).toBeTruthy();

    clearCryptoTestState();
    await loadCryptoEngine();
    await restoreKeysFromBackup(parsed);
    expect(getSessions()).toEqual({});

    await expect(
      window.e2ee.decryptEnvelope({ ...captured[0], senderDeviceId: Alice.deviceId }),
    ).rejects.toThrow();
  }, 60000);
});

describe("failed decrypt does not mutate ratchet state", () => {
  let Alice;
  let Bob;

  beforeAll(async () => {
    Alice = await genDevice("device-alice-c");
    Bob = await genDevice("device-bob-c");
  }, 60000);

  beforeEach(() => {
    clearCryptoTestState();
    vi.stubGlobal("indexedDB", undefined);
  });

  it("a forged high-index WHISPER does not persist skipped keys", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const env0 = (await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "m0")).envelopes[0];
    const aliceSessions = getSessions();

    await activateDevice(Bob);
    await expect(window.e2ee.decryptEnvelope({ ...env0, senderDeviceId: Alice.deviceId })).resolves.toBe("m0");
    const before = JSON.parse(JSON.stringify(getSessions()));

    await activateDevice(Alice, aliceSessions);
    const env1 = (await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "m1")).envelopes[0];

    await activateDevice(Bob, before);
    await expect(
      window.e2ee.decryptEnvelope({
        ...env1,
        senderDeviceId: Alice.deviceId,
        messageIndex: 1500,
        ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAA",
      }),
    ).rejects.toThrow();

    expect(getSessions()).toEqual(before);
  }, 60000);

  it("a forged PREKEY_WHISPER cannot destroy a healthy live session", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const env0 = (await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "m0")).envelopes[0];

    await activateDevice(Bob);
    await window.e2ee.decryptEnvelope({ ...env0, senderDeviceId: Alice.deviceId });
    const healthy = JSON.parse(JSON.stringify(getSessions()));

    await expect(
      window.e2ee.decryptEnvelope({
        ...env0,
        senderDeviceId: Alice.deviceId,
        ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAA",
      }),
    ).rejects.toThrow(/PREKEY_REPLAY/);

    expect(getSessions()).toEqual(healthy);
  }, 60000);
});

describe("SELF_WHISPER reseeds after a caught-up round trip", () => {
  beforeEach(() => {
    clearCryptoTestState();
    vi.stubGlobal("indexedDB", undefined);
  });

  it("changes the self ratchet public key after decrypt catches the sending chain", async () => {
    await loadCryptoEngine();
    const me = await genDevice("device-me");
    await activateDevice(me);
    const api = vi.fn(async (path) => {
      if (path.includes("resolve-chat-devices")) {
        return { targetDevices: [{ userId: 1, deviceId: me.deviceId }] };
      }
      return {};
    });

    const first = (await window.e2ee.buildFanoutRequest(api, 100, "self-0")).envelopes[0];
    await window.e2ee.decryptEnvelope({ ...first, senderDeviceId: me.deviceId });
    const second = (await window.e2ee.buildFanoutRequest(api, 100, "self-1")).envelopes[0];
    expect(second.ratchetPublicKey).not.toBe(first.ratchetPublicKey);
    await expect(window.e2ee.decryptEnvelope({ ...second, senderDeviceId: me.deviceId })).resolves.toBe("self-1");
  }, 60000);
});

describe("restore does not resurrect a consumed one-time prekey", () => {
  let Alice;
  let Bob;

  beforeAll(async () => {
    Alice = await genDevice("device-alice-d");
    Bob = await genDevice("device-bob-d");
  }, 60000);

  beforeEach(() => {
    clearCryptoTestState();
    vi.stubGlobal("indexedDB", undefined);
  });

  it("refuses the same PREKEY envelope after an identity-only restore", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const env0 = (await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "one-shot message")).envelopes[0];

    clearCryptoTestState();
    await loadCryptoEngine();
    await activateDevice(Bob);
    const { createEncryptedBackup, decryptBackup, restoreKeysFromBackup } = await import("../backup.js");
    const blob = await createEncryptedBackup("pass");
    const parsed = await decryptBackup(blob.encryptedPayload, blob.salt, blob.iv, "pass", blob.checksum);

    await expect(window.e2ee.decryptEnvelope({ ...env0, senderDeviceId: Alice.deviceId })).resolves.toBe(
      "one-shot message",
    );
    await expect(
      window.e2ee.decryptEnvelope({ ...env0, senderDeviceId: Alice.deviceId }),
    ).rejects.toThrow(/PREKEY_REPLAY/);

    await restoreKeysFromBackup(parsed);
    await expect(window.e2ee.decryptEnvelope({ ...env0, senderDeviceId: Alice.deviceId })).rejects.toThrow();
  }, 60000);
});
