import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

function b64urlJson(value) {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function loadCryptoEngine() {
  vi.resetModules();
  return import("../crypto-engine.ts");
}

function bytesToB64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function testBundle() {
  return {
    deviceId: "device-self",
    registrationId: 1,
    identity: {
      publicKey: bytesToB64(new Uint8Array(32).fill(7)),
      privateKeyPkcs8: bytesToB64(new Uint8Array(64).fill(13)),
    },
    signingKey: {
      publicKeySpki: "signing-public",
      privateKeyPkcs8: "signing-private",
    },
    signedPreKey: {
      preKeyId: 1,
      publicKey: "signed-pre-key-public",
      privateKeyPkcs8: "signed-pre-key-private",
      signature: "signature",
    },
    oneTimePreKeys: [],
  };
}

async function activateDevice(bundle, sessions = {}) {
  await window.e2ee.importLocalDeviceBundle(bundle);
  await window.e2ee.__importSessionStateForTests(sessions);
}

function getSessions() {
  return window.e2ee.__exportSessionStateForTests();
}

function clearCryptoTestState() {
  localStorage.clear();
  sessionStorage.clear();
  delete window.e2ee;
  delete globalThis.__chaosSecureStorageMemoryV1;
}

describe("crypto-engine frontend safety checks", () => {
  beforeEach(() => {
    clearCryptoTestState();
    vi.stubGlobal("indexedDB", undefined);
  });

  it("exports a module engine and leaves a pre-bound window adapter in place", async () => {
    window.e2ee = { getOrCreateDeviceId: () => "stub-device" };
    const { e2ee } = await loadCryptoEngine();
    expect(window.e2ee.getOrCreateDeviceId()).toBe("stub-device");
    expect(e2ee.buildFanoutRequest).toEqual(expect.any(Function));
    expect(e2ee).not.toBe(window.e2ee);
  });

  it("migrates legacy private state to secure storage and removes it from localStorage", async () => {
    const bundle = testBundle();
    const sessions = { "device:a:remote:b": { Ns: 1 } };

    localStorage.setItem("cm_device_id:alice", bundle.deviceId);
    localStorage.setItem("cm_device_bundle_v2:alice", JSON.stringify(bundle));
    localStorage.setItem("cm_e2ee_sessions_v5:alice", JSON.stringify(sessions));

    const { e2ee } = await loadCryptoEngine();

    expect(e2ee).toBe(window.e2ee);
    expect(localStorage.getItem("cm_device_id")).toBe(bundle.deviceId);
    expect(window.e2ee.getLocalDeviceBundle()).toEqual(bundle);
    expect(window.e2ee.__exportSessionStateForTests()).toEqual(sessions);
    expect(window.e2ee.getSecureStorageBackend()).toBe("memory");

    expect(localStorage.getItem("cm_device_bundle_v2")).toBeNull();
    expect(localStorage.getItem("cm_e2ee_sessions_v5")).toBeNull();
    expect(localStorage.getItem("cm_device_id:alice")).toBeNull();
    expect(localStorage.getItem("cm_device_bundle_v2:alice")).toBeNull();
    expect(localStorage.getItem("cm_e2ee_sessions_v5:alice")).toBeNull();
  });

  it("does not overwrite an existing unscoped device id during migration", async () => {
    localStorage.setItem("cm_device_id", "device-current");
    localStorage.setItem("cm_device_id:alice", "device-old");

    await loadCryptoEngine();

    expect(localStorage.getItem("cm_device_id")).toBe("device-current");
    expect(localStorage.getItem("cm_device_id:alice")).toBeNull();
  });

  it("getOrCreateDeviceId creates a stable non-secret device id", async () => {
    await loadCryptoEngine();
    const first = window.e2ee.getOrCreateDeviceId();
    const second = window.e2ee.getOrCreateDeviceId();
    expect(first).toMatch(/^device-/);
    expect(second).toBe(first);
    expect(localStorage.getItem("cm_device_id")).toBe(first);
  });

  it("resetLocalDeviceIdentity removes secure keys, sessions and the old id", async () => {
    await loadCryptoEngine();
    const bundle = testBundle();
    await activateDevice(bundle, { session: true });

    await window.e2ee.resetLocalDeviceIdentity();

    expect(window.e2ee.getLocalDeviceBundle()).toBeNull();
    expect(window.e2ee.__exportSessionStateForTests()).toEqual({});
    expect(localStorage.getItem("cm_device_id")).toBeNull();
    expect(window.e2ee.getOrCreateDeviceId()).toMatch(/^device-/);
    expect(window.e2ee.getOrCreateDeviceId()).not.toBe(bundle.deviceId);
  });

  it("decryptEnvelope fails clearly when the local bundle is missing", async () => {
    await loadCryptoEngine();
    await expect(window.e2ee.decryptEnvelope({
      messageType: "SELF_WHISPER",
      ciphertext: "bad",
      nonce: "bad",
    })).rejects.toThrow("Local device bundle is missing");
  });

  it("encrypts self envelopes with a ratchet session, not the identity key", async () => {
    await loadCryptoEngine();
    const bundle = testBundle();
    await activateDevice(bundle);

    const api = vi.fn(async (path) => {
      if (path === "/api/crypto/devices/current/prekeys") return { available: 50 };
      expect(path).toBe("/api/crypto/resolve-chat-devices/100");
      return { targetDevices: [{ userId: 1, deviceId: bundle.deviceId }] };
    });

    const request = await window.e2ee.buildFanoutRequest(api, 100, "private self secret");
    const selfEnvelope = request.envelopes[0];
    expect(selfEnvelope.messageType).toBe("SELF_WHISPER");
    expect(selfEnvelope.ratchetPublicKey).toBeTruthy();
    expect(selfEnvelope.messageIndex).toBe(0);

    const sessions = getSessions();
    await window.e2ee.importLocalDeviceBundle({
      ...bundle,
      identity: {
        ...bundle.identity,
        publicKey: bytesToB64(new Uint8Array(32).fill(99)),
      },
    });
    await window.e2ee.__importSessionStateForTests(sessions);

    await expect(window.e2ee.decryptEnvelope(selfEnvelope)).resolves.toBe("private self secret");
  });

  it("decrypts a self whisper after the timeline DTO drops senderDeviceId", async () => {
    await loadCryptoEngine();
    const bundle = testBundle();
    await activateDevice(bundle);
    const api = vi.fn(async (path) => {
      if (path === "/api/crypto/devices/current/prekeys") return { available: 50 };
      return { targetDevices: [{ userId: 1, deviceId: bundle.deviceId }] };
    });
    const request = await window.e2ee.buildFanoutRequest(api, 100, "timeline self");
    const stored = request.envelopes[0];
    const { envelopeForDecrypt } = await import("../messageModel");
    const envelope = envelopeForDecrypt({
      targetDeviceId: stored.targetDeviceId,
      messageType: stored.messageType,
      senderIdentityPublicKey: stored.senderIdentityPublicKey,
      ephemeralPublicKey: stored.ephemeralPublicKey,
      ciphertext: stored.ciphertext,
      nonce: stored.nonce,
      signedPreKeyId: stored.signedPreKeyId,
      oneTimePreKeyId: stored.oneTimePreKeyId,
      messageIndex: stored.messageIndex,
      ratchetPublicKey: stored.ratchetPublicKey,
      previousChainLength: stored.previousChainLength,
    }, bundle.deviceId, 100);
    await expect(window.e2ee.decryptEnvelope(envelope)).resolves.toBe("timeline self");
  });

  it("does not decrypt self envelopes derived from public identity material", async () => {
    await loadCryptoEngine();
    const bundle = testBundle();
    await activateDevice(bundle);

    const raw = Uint8Array.from(atob(bundle.identity.publicKey), (c) => c.charCodeAt(0));
    const hkdfKey = await crypto.subtle.importKey("raw", raw, { name: "HKDF" }, false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("ChaosMessengerSelf") },
      hkdfKey,
      256
    );
    const key = await crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt"]);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      new TextEncoder().encode("legacy secret")
    ));

    await expect(window.e2ee.decryptEnvelope({
      messageType: "SELF_WHISPER",
      ciphertext: bytesToB64(ciphertext),
      nonce: bytesToB64(nonce),
    })).rejects.toThrow();
  });
});

describe("Double Ratchet full protocol cycle", () => {
  let Alice;
  let Bob;

  async function genDevice(deviceId) {
    const identityKey = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const signedPreKey = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const signingKey = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
    );

    const identityPub = new Uint8Array(await crypto.subtle.exportKey("raw", identityKey.publicKey));
    const identityPriv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", identityKey.privateKey));
    const signedPreKeyPub = new Uint8Array(await crypto.subtle.exportKey("raw", signedPreKey.publicKey));
    const signedPreKeyPriv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", signedPreKey.privateKey));
    const signingPub = new Uint8Array(await crypto.subtle.exportKey("spki", signingKey.publicKey));
    const signingPriv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", signingKey.privateKey));
    const signedPreKeySig = new Uint8Array(await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, signingKey.privateKey, signedPreKeyPub
    ));
    const oneTimeKey = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const oneTimePub = new Uint8Array(await crypto.subtle.exportKey("raw", oneTimeKey.publicKey));
    const oneTimePriv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", oneTimeKey.privateKey));

    return {
      deviceId,
      registrationId: 1,
      identity: { publicKey: bytesToB64(identityPub), privateKeyPkcs8: bytesToB64(identityPriv) },
      signingKey: { publicKeySpki: bytesToB64(signingPub), privateKeyPkcs8: bytesToB64(signingPriv) },
      signedPreKey: {
        preKeyId: 1,
        publicKey: bytesToB64(signedPreKeyPub),
        privateKeyPkcs8: bytesToB64(signedPreKeyPriv),
        signature: bytesToB64(signedPreKeySig),
        createdAt: Date.now(),
      },
      oneTimePreKeys: [{
        preKeyId: 1001,
        publicKey: bytesToB64(oneTimePub),
        privateKeyPkcs8: bytesToB64(oneTimePriv),
      }],
    };
  }

  function makeApi(targetBundle) {
    const oneTimePreKey = targetBundle.oneTimePreKeys?.[0]
      ? {
          preKeyId: targetBundle.oneTimePreKeys[0].preKeyId,
          publicKey: targetBundle.oneTimePreKeys[0].publicKey,
        }
      : null;
    return vi.fn(async (path) => {
      if (path.includes("resolve-chat-devices")) {
        return {
          targetDevices: [{
            userId: 42,
            deviceId: targetBundle.deviceId,
            identityPublicKey: targetBundle.identity.publicKey,
            signingPublicKey: targetBundle.signingKey.publicKeySpki,
            signedPreKey: targetBundle.signedPreKey,
            oneTimePreKey: null,
          }],
        };
      }
      if (path.includes("reserve-prekey")) {
        return { signedPreKey: targetBundle.signedPreKey, oneTimePreKey };
      }
      return {};
    });
  }

  async function withOneTimePreKey(bundle, preKeyId = 1001) {
    const keyPair = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
    return {
      ...bundle,
      oneTimePreKeys: [{
        preKeyId,
        publicKey: bytesToB64(publicKey),
        privateKeyPkcs8: bytesToB64(privateKey),
      }],
    };
  }

  beforeAll(async () => {
    Alice = await genDevice("device-alice");
    Bob = await genDevice("device-bob");
  }, 30000);

  beforeEach(() => {
    clearCryptoTestState();
    vi.stubGlobal("indexedDB", undefined);
  });

  it("completes a bidirectional X3DH + Double Ratchet cycle", async () => {
    await loadCryptoEngine();

    await activateDevice(Alice);
    const fanout = await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "hello from alice");
    const env1 = fanout.envelopes[0];
    expect(env1.messageType).toBe("PREKEY_WHISPER");
    const aliceSessions = getSessions();

    await activateDevice(Bob);
    await expect(window.e2ee.decryptEnvelope({ ...env1, senderDeviceId: Alice.deviceId }))
      .resolves.toBe("hello from alice");
    const bobSessions = getSessions();

    await activateDevice(Bob, bobSessions);
    const fanout2 = await window.e2ee.buildFanoutRequest(makeApi(Alice), 100, "hello from bob");
    const env2 = fanout2.envelopes[0];
    expect(env2.messageType).toBe("WHISPER");
    expect(env2.ratchetPublicKey).not.toBe(env1.ratchetPublicKey);

    await activateDevice(Alice, aliceSessions);
    await expect(window.e2ee.decryptEnvelope({ ...env2, senderDeviceId: Bob.deviceId }))
      .resolves.toBe("hello from bob");

    const nrAfter = getSessions()[Bob.deviceId]?.Nr;
    await expect(window.e2ee.decryptEnvelope({ ...env2, senderDeviceId: Bob.deviceId }))
      .rejects.toThrow();
    expect(getSessions()[Bob.deviceId]?.Nr).toBe(nrAfter);
  }, 30000);

  it("decrypts after the server strips client-only _chatId when the caller rebinds chat context", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const fanout = await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "hello from alice");
    const { _chatId, ...wireEnvelope } = fanout.envelopes[0];
    expect(_chatId).toBe(100);

    await activateDevice(Bob);
    await expect(window.e2ee.decryptEnvelope({
      ...wireEnvelope,
      senderDeviceId: Alice.deviceId,
    })).rejects.toThrow();

    await expect(window.e2ee.decryptEnvelope({
      ...wireEnvelope,
      senderDeviceId: Alice.deviceId,
      _chatId: 100,
    })).resolves.toBe("hello from alice");
  }, 30000);

  it("does not DH-ratchet when the ratchet public key is the same bytes with another encoding", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const first = await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "one");
    const env1 = first.envelopes[0];
    const aliceSessions = getSessions();

    await activateDevice(Bob);
    await expect(window.e2ee.decryptEnvelope({ ...env1, senderDeviceId: Alice.deviceId }))
      .resolves.toBe("one");

    const bobSessions = getSessions();
    const sessionKey = Object.keys(bobSessions)[0];
    const dhr = bobSessions[sessionKey].DHr;
    bobSessions[sessionKey].DHr = dhr.replace(/=+$/g, "");
    expect(bobSessions[sessionKey].DHr).not.toBe(dhr);

    await activateDevice(Alice, aliceSessions);
    const second = await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "two");
    const env2 = second.envelopes[0];

    await activateDevice(Bob, bobSessions);
    await expect(window.e2ee.decryptEnvelope({
      ...env2,
      senderDeviceId: Alice.deviceId,
    })).resolves.toBe("two");
  }, 30000);

  it("serializes concurrent sends and never reuses a message index", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);

    const requests = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        window.e2ee.buildFanoutRequest(makeApi(Bob), 100, `msg-${index}`)
      )
    );
    const indexes = requests.map(request => request.envelopes[0].messageIndex);
    expect(indexes).toEqual([0, 1, 2, 3, 4, 5]);

    await activateDevice(Bob);
    for (let index = 0; index < requests.length; index++) {
      await expect(window.e2ee.decryptEnvelope({
        ...requests[index].envelopes[0],
        senderDeviceId: Alice.deviceId,
      })).resolves.toBe(`msg-${index}`);
    }
  }, 30000);

  it("supports out-of-order delivery through skipped message keys", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const envelopes = [];
    for (let index = 0; index < 5; index++) {
      const fanout = await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, `msg-${index}`);
      envelopes.push(fanout.envelopes[0]);
    }

    await activateDevice(Bob);
    await expect(window.e2ee.decryptEnvelope({ ...envelopes[0], senderDeviceId: Alice.deviceId }))
      .resolves.toBe("msg-0");
    for (const index of [4, 2, 1, 3]) {
      await expect(window.e2ee.decryptEnvelope({ ...envelopes[index], senderDeviceId: Alice.deviceId }))
        .resolves.toBe(`msg-${index}`);
    }
  }, 30000);

  it("persists verified identity state and blocks unexpected identity key changes", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);

    await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "first contact");
    expect(window.e2ee.getRemoteIdentityTrust(Bob.deviceId, Bob.identity.publicKey).trustState)
      .toBe("UNVERIFIED");

    await window.e2ee.verifyRemoteIdentity(Bob.deviceId, Bob.identity.publicKey, "SAFETY_NUMBER");
    expect(window.e2ee.getRemoteIdentityTrust(Bob.deviceId, Bob.identity.publicKey))
      .toEqual(expect.objectContaining({
        trustState: "VERIFIED",
        verificationMethod: "SAFETY_NUMBER",
      }));

    const changedBob = {
      ...Bob,
      identity: { ...Bob.identity, publicKey: bytesToB64(new Uint8Array(32).fill(55)) },
    };
    await expect(window.e2ee.buildFanoutRequest(makeApi(changedBob), 100, "must block"))
      .rejects.toThrow(`IDENTITY_KEY_CHANGED:${Bob.deviceId}`);
  }, 30000);


  it("consumes a one-time pre-key only after authenticated bootstrap and rejects replay", async () => {
    await loadCryptoEngine();
    const bobWithPreKey = await withOneTimePreKey(Bob, 1777);

    await activateDevice(Alice);
    const fanout = await window.e2ee.buildFanoutRequest(makeApi(bobWithPreKey), 100, "one-time hello");
    const envelope = fanout.envelopes[0];
    expect(envelope.oneTimePreKeyId).toBe(1777);

    await activateDevice(bobWithPreKey);
    await expect(window.e2ee.decryptEnvelope({ ...envelope, senderDeviceId: Alice.deviceId }))
      .resolves.toBe("one-time hello");
    expect(window.e2ee.getLocalDeviceBundle().oneTimePreKeys).toEqual([]);

    await expect(window.e2ee.decryptEnvelope({ ...envelope, senderDeviceId: Alice.deviceId }))
      .rejects.toThrow(`PREKEY_REPLAY:${Alice.deviceId}`);
  }, 30000);

  it("does not re-register an existing local device just because login can register", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const api = vi.fn(async (path) => {
      if (String(path).includes("/crypto/devices/register")) {
        throw new Error("should not re-register existing device");
      }
      if (String(path).includes("prekeys")) return { available: 50 };
      return {};
    });
    api.__canRegisterDevice = true;
    await expect(window.e2ee.ensureDeviceRegistered(api)).resolves.toMatchObject({
      deviceId: Alice.deviceId,
    });
  }, 30000);

  it("registers an existing local device when the server does not know it", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const api = vi.fn(async (path) => {
      if (String(path).includes("/crypto/devices/register")) {
        return { deviceId: Alice.deviceId };
      }
      if (String(path).includes("prekeys")) {
        const error = new Error("Current device is not registered");
        error.status = 404;
        throw error;
      }
      return {};
    });
    await expect(window.e2ee.ensureDeviceRegistered(api)).resolves.toMatchObject({
      deviceId: Alice.deviceId,
    });
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining("/crypto/devices/register"),
      expect.anything()
    );
  }, 30000);

  it("does not re-register a revoked device", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const api = vi.fn(async (path) => {
      if (String(path).includes("/crypto/devices/register")) {
        throw new Error("should not re-register revoked device");
      }
      if (String(path).includes("prekeys")) {
        const error = new Error("Current device is revoked or inactive");
        error.status = 401;
        error.code = "DEVICE_REVOKED";
        throw error;
      }
      return {};
    });
    await expect(window.e2ee.ensureDeviceRegistered(api)).rejects.toMatchObject({
      code: "DEVICE_REVOKED",
    });
    expect(api).not.toHaveBeenCalledWith(
      expect.stringContaining("/crypto/devices/register"),
      expect.anything()
    );
  }, 30000);

  it("re-establishes the session when the peer returns with PREKEY after local ratchet loss", async () => {
    await loadCryptoEngine();

    await activateDevice(Alice);
    const first = await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "hello from alice");
    const aliceSessions = getSessions();

    await activateDevice(Bob);
    await expect(window.e2ee.decryptEnvelope({
      ...first.envelopes[0],
      senderDeviceId: Alice.deviceId,
    })).resolves.toBe("hello from alice");

    await window.e2ee.__importSessionStateForTests({});

    await activateDevice(Alice, aliceSessions);
    const stale = await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "stale whisper");
    expect(stale.envelopes[0].messageType).toBe("WHISPER");

    await activateDevice(Bob);
    await window.e2ee.__importSessionStateForTests({});
    await expect(window.e2ee.decryptEnvelope({
      ...stale.envelopes[0],
      senderDeviceId: Alice.deviceId,
    })).rejects.toThrow(/SESSION_STALE/);

    const reinit = await window.e2ee.buildFanoutRequest(makeApi(Alice), 100, "hello from bob");
    expect(reinit.envelopes[0].messageType).toBe("PREKEY_WHISPER");
    const bobSessions = getSessions();

    await activateDevice(Alice, aliceSessions);
    await expect(window.e2ee.decryptEnvelope({
      ...reinit.envelopes[0],
      senderDeviceId: Bob.deviceId,
    })).resolves.toBe("hello from bob");

    const aliceReply = await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "alice after heal");
    expect(aliceReply.envelopes[0].messageType).toBe("WHISPER");

    await activateDevice(Bob, bobSessions);
    await expect(window.e2ee.decryptEnvelope({
      ...aliceReply.envelopes[0],
      senderDeviceId: Alice.deviceId,
    })).resolves.toBe("alice after heal");
  }, 30000);

  it("decrypts after a reload that only restores persisted ratchet state", async () => {
    await loadCryptoEngine();

    await activateDevice(Alice);
    const first = await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "before reload");
    const aliceSessions = getSessions();

    await activateDevice(Bob);
    await expect(window.e2ee.decryptEnvelope({
      ...first.envelopes[0],
      senderDeviceId: Alice.deviceId,
    })).resolves.toBe("before reload");
    const bobSessions = getSessions();
    const bobBundle = window.e2ee.getLocalDeviceBundle();

    clearCryptoTestState();
    await loadCryptoEngine();
    await activateDevice(bobBundle, bobSessions);

    await activateDevice(Alice, aliceSessions);
    const second = await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "after reload");

    await activateDevice(bobBundle, bobSessions);
    await expect(window.e2ee.decryptEnvelope({
      ...second.envelopes[0],
      senderDeviceId: Alice.deviceId,
    })).resolves.toBe("after reload");
  }, 30000);

  it("keeps a one-time pre-key when bootstrap ciphertext authentication fails", async () => {
    await loadCryptoEngine();
    const bobWithPreKey = await withOneTimePreKey(Bob, 1888);

    await activateDevice(Alice);
    const fanout = await window.e2ee.buildFanoutRequest(makeApi(bobWithPreKey), 100, "authentic payload");
    const envelope = fanout.envelopes[0];

    await activateDevice(bobWithPreKey);
    const tampered = {
      ...envelope,
      senderDeviceId: Alice.deviceId,
      ciphertext: envelope.ciphertext.slice(0, -4) + "AAAA",
    };
    await expect(window.e2ee.decryptEnvelope(tampered)).rejects.toThrow();
    expect(window.e2ee.getLocalDeviceBundle().oneTimePreKeys.map(key => key.preKeyId)).toEqual([1888]);
    expect(window.e2ee.__exportSessionStateForTests()).toEqual({});

    await expect(window.e2ee.decryptEnvelope({ ...envelope, senderDeviceId: Alice.deviceId }))
      .resolves.toBe("authentic payload");
  }, 30000);

  it("rejects decryption when the local bundle is missing", async () => {
    await loadCryptoEngine();
    await expect(window.e2ee.decryptEnvelope({
      messageType: "WHISPER", senderDeviceId: "x", ciphertext: "x", nonce: "x",
    })).rejects.toThrow("Local device bundle is missing");
  });

  it("self-whisper works alongside Double Ratchet", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const api = vi.fn(async (path) => {
      if (path.includes("resolve-chat-devices")) {
        return { targetDevices: [{ userId: 1, deviceId: Alice.deviceId }] };
      }
      return {};
    });
    const fanout = await window.e2ee.buildFanoutRequest(api, 100, "self note");
    expect(fanout.envelopes[0].messageType).toBe("SELF_WHISPER");
    await expect(window.e2ee.decryptEnvelope({
      ...fanout.envelopes[0], senderDeviceId: Alice.deviceId,
    })).resolves.toBe("self note");
  });

  it("binds self-whisper ciphertext to chat id", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const api = vi.fn(async (path) => {
      if (path.includes("resolve-chat-devices")) {
        return { targetDevices: [{ userId: 1, deviceId: Alice.deviceId }] };
      }
      if (path.includes("prekeys")) return { available: 50 };
      return {};
    });
    const fanout = await window.e2ee.buildFanoutRequest(api, 100, "self note");
    await expect(window.e2ee.decryptEnvelope({
      ...fanout.envelopes[0],
      senderDeviceId: Alice.deviceId,
      _chatId: 101,
    })).rejects.toThrow();
  });

  it("does not decrypt a ratcheted self envelope from the identity key alone", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const api = vi.fn(async (path) => {
      if (path.includes("resolve-chat-devices")) {
        return { targetDevices: [{ userId: 1, deviceId: Alice.deviceId }] };
      }
      if (path.includes("prekeys")) return { available: 50 };
      return {};
    });
    const fanout = await window.e2ee.buildFanoutRequest(api, 100, "self note");
    await window.e2ee.__importSessionStateForTests({});
    await expect(window.e2ee.decryptEnvelope({
      ...fanout.envelopes[0],
      senderDeviceId: Alice.deviceId,
    })).rejects.toThrow(/SESSION_STALE/);
  });

  it("refuses to start a session when the one-time pre-key pool is empty", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    const emptyBob = { ...Bob, oneTimePreKeys: [] };
    await expect(window.e2ee.buildFanoutRequest(makeApi(emptyBob), 100, "no otk"))
      .rejects.toThrow(/ONE_TIME_PREKEY_EXHAUSTED/);
  });

  it("keeps an initiator session after a forged whisper fails", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "hello");
    const before = getSessions();
    await expect(window.e2ee.decryptEnvelope({
      messageType: "WHISPER",
      senderDeviceId: Bob.deviceId,
      senderIdentityPublicKey: Bob.identity.publicKey,
      ciphertext: "AAAA",
      nonce: "AAAA",
      ratchetPublicKey: "AAAA",
      messageIndex: 0,
      _chatId: 100,
    })).rejects.toThrow();
    expect(Object.keys(getSessions())).toEqual(Object.keys(before));
  });

  it("blocks send to a newly appeared device once another device of that user is verified", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    await window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "first contact");
    await window.e2ee.verifyRemoteIdentity(Bob.deviceId, Bob.identity.publicKey, "SAFETY_NUMBER");

    const laptop = await genDevice("device-bob-laptop");
    const api = vi.fn(async (path) => {
      if (path.includes("resolve-chat-devices")) {
        return {
          targetDevices: [
            {
              userId: 42,
              deviceId: Bob.deviceId,
              identityPublicKey: Bob.identity.publicKey,
              signingPublicKey: Bob.signingKey.publicKeySpki,
              signedPreKey: Bob.signedPreKey,
            },
            {
              userId: 42,
              deviceId: laptop.deviceId,
              identityPublicKey: laptop.identity.publicKey,
              signingPublicKey: laptop.signingKey.publicKeySpki,
              signedPreKey: laptop.signedPreKey,
              oneTimePreKey: laptop.oneTimePreKeys[0],
            },
          ],
        };
      }
      if (path.includes("reserve-prekey")) {
        return { signedPreKey: laptop.signedPreKey, oneTimePreKey: laptop.oneTimePreKeys[0] };
      }
      if (path.includes("prekeys")) return { available: 50 };
      return {};
    });

    await expect(window.e2ee.buildFanoutRequest(api, 100, "must not copy to laptop"))
      .rejects.toThrow(`UNVERIFIED_DEVICE:${laptop.deviceId}`);
  }, 30000);

  it("keeps verified identities across backup restore", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    await window.e2ee.verifyRemoteIdentity(Bob.deviceId, Bob.identity.publicKey, "SAFETY_NUMBER");
    await window.e2ee.importLocalDeviceBundle(Alice);
    expect(window.e2ee.getRemoteIdentityTrust(Bob.deviceId, Bob.identity.publicKey).trustState)
      .toBe("VERIFIED");
  });

  it("blocks send and decrypt after an explicit block", async () => {
    await loadCryptoEngine();
    await activateDevice(Alice);
    await window.e2ee.blockRemoteIdentity(Bob.deviceId, Bob.identity.publicKey);
    await expect(window.e2ee.buildFanoutRequest(makeApi(Bob), 100, "nope"))
      .rejects.toThrow(`IDENTITY_BLOCKED:${Bob.deviceId}`);
  });
});
