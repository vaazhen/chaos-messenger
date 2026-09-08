import { beforeEach, describe, expect, it, vi } from "vitest";

const deviceMocks = vi.hoisted(() => ({
  getOrCreateDeviceId: vi.fn(() => "alice-phone"),
}));

vi.mock("../deviceId", () => ({
  getOrCreateDeviceId: deviceMocks.getOrCreateDeviceId,
}));

vi.mock("../api", () => ({
  getToken: () => "token",
}));

describe("callMediaE2ee", () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.e2ee;
    delete globalThis.RTCRtpScriptTransform;
    delete globalThis.RTCRtpSender;
    vi.stubGlobal("Worker", class MockWorker {
      postMessage() {}
    });
  });

  it("reports insertable-stream support only when the browser has the APIs", async () => {
    const { supportsMediaE2ee } = await import("../callMediaE2ee");
    expect(supportsMediaE2ee()).toBe(false);

    globalThis.RTCRtpSender = function RTCRtpSender() {};
    globalThis.RTCRtpSender.prototype.createEncodedStreams = function createEncodedStreams() {
      return { readable: {}, writable: {} };
    };
    expect(supportsMediaE2ee()).toBe(true);
  });

  it("wraps a call key in E2EE fan-out envelopes", async () => {
    window.e2ee = {
      buildFanoutRequest: vi.fn(async () => ({
        senderDeviceId: "alice-phone",
        envelopes: [{ targetDeviceId: "bob-laptop", ciphertext: "x" }],
      })),
    };
    const { encryptCallKeyForChat, generateCallKey } = await import("../callMediaE2ee");
    const envelopes = await encryptCallKeyForChat(9, generateCallKey());
    expect(window.e2ee.buildFanoutRequest).toHaveBeenCalled();
    expect(envelopes).toEqual([{ targetDeviceId: "bob-laptop", ciphertext: "x", senderDeviceId: "alice-phone" }]);
  });

  it("generates a 32-byte call key and skips fan-out without an E2EE engine", async () => {
    const { generateCallKey, encryptCallKeyForChat, decryptCallKeyEnvelope } = await import("../callMediaE2ee");
    expect(generateCallKey()).toHaveLength(32);
    await expect(encryptCallKeyForChat(1, generateCallKey())).resolves.toEqual([]);
    await expect(decryptCallKeyEnvelope([])).resolves.toBeNull();
    await expect(decryptCallKeyEnvelope(null)).resolves.toBeNull();
  });

  it("decrypts the envelope addressed to this device", async () => {
    window.e2ee = {
      decryptEnvelope: vi.fn(async (envelope) => envelope.plaintext),
    };
    const { decryptCallKeyEnvelope } = await import("../callMediaE2ee");
    const key = new Uint8Array(32).fill(7);
    const encoded = btoa(String.fromCharCode(...key));
    const bytes = await decryptCallKeyEnvelope([
      { targetDeviceId: "other", plaintext: "chaos-call-key:v1:ignore" },
      { targetDeviceId: "alice-phone", plaintext: `chaos-call-key:v1:${encoded}` },
    ]);
    expect(Array.from(bytes)).toEqual(Array.from(key));
  });

  it("does not unwrap another device envelope as a fallback", async () => {
    window.e2ee = {
      decryptEnvelope: vi.fn(async (envelope) => envelope.plaintext),
    };
    const { decryptCallKeyEnvelope } = await import("../callMediaE2ee");
    const key = new Uint8Array(32).fill(7);
    const encoded = btoa(String.fromCharCode(...key));
    await expect(decryptCallKeyEnvelope([
      { targetDeviceId: "other", plaintext: `chaos-call-key:v1:${encoded}` },
    ])).resolves.toBeNull();
    expect(window.e2ee.decryptEnvelope).not.toHaveBeenCalled();
  });

  it("rejects envelopes that are not call keys", async () => {
    window.e2ee = {
      decryptEnvelope: vi.fn(async () => "not-a-call-key"),
    };
    const { decryptCallKeyEnvelope } = await import("../callMediaE2ee");
    await expect(decryptCallKeyEnvelope([{ targetDeviceId: "alice-phone" }])).resolves.toBeNull();
  });

  it("attaches encoded-stream transforms when the sender supports them", async () => {
    const { protectPeerConnection, protectSender } = await import("../callMediaE2ee");
    const rawKey = new Uint8Array(32).fill(1);
    expect(await protectPeerConnection(null, rawKey)).toBe(false);
    expect(await protectSender(null, rawKey)).toBe(false);

    const sender = {
      createEncodedStreams: () => ({ readable: {}, writable: {} }),
    };
    const pc = {
      getSenders: () => [sender],
      getReceivers: () => [],
    };
    expect(await protectPeerConnection(pc, rawKey)).toBe(true);
  });
});
