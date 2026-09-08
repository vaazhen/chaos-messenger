import { describe, expect, it } from "vitest";
import { ENVELOPE_AAD_VERSION, envelopeAadHex } from "../envelopeAad";

describe("envelope AAD v3 vectors", () => {
  it("keeps the published version byte", () => {
    expect(ENVELOPE_AAD_VERSION).toBe(0x03);
  });

  it("encodes a whisper with a 64-bit chat id and empty device ids", () => {
    expect(envelopeAadHex({
      messageType: "WHISPER",
      chatId: 100,
      messageIndex: 0,
      previousChainLength: 0,
    })).toBe("030200000000000000640000000000000000000000000000000000000000");
  });

  it("encodes a prekey whisper with index and previous chain length", () => {
    expect(envelopeAadHex({
      messageType: "PREKEY_WHISPER",
      chatId: 1,
      messageIndex: 7,
      previousChainLength: 3,
    })).toBe("030100000000000000010000000700000003000000000000000000000000");
  });

  it("encodes a self-whisper with a missing chat id as zero", () => {
    expect(envelopeAadHex({
      messageType: "SELF_WHISPER",
    })).toBe("030300000000000000000000000000000000000000000000000000000000");
  });

  it("appends sender, target, and ratchet public key as length-prefixed latin-1", () => {
    expect(envelopeAadHex({
      messageType: "WHISPER",
      chatId: 100,
      messageIndex: 2,
      previousChainLength: 1,
      senderDeviceId: "device-a",
      targetDeviceId: "device-b",
      ratchetPublicKey: "AB",
    })).toBe("03020000000000000064000000020000000100000000000000086465766963652d61000000086465766963652d62000000024142");
  });

  it("uses type code 0 for an unknown message type", () => {
    expect(envelopeAadHex({
      messageType: "UNKNOWN",
      chatId: 0,
    })).toBe("030000000000000000000000000000000000000000000000000000000000");
  });

  it("changes the hex when any bound field changes", () => {
    const base = {
      messageType: "WHISPER",
      chatId: 100,
      messageIndex: 2,
      previousChainLength: 1,
      senderDeviceId: "device-a",
      targetDeviceId: "device-b",
      ratchetPublicKey: "AB",
    };
    const baseline = envelopeAadHex(base);
    const mutants = [
      { ...base, messageType: "PREKEY_WHISPER" },
      { ...base, chatId: 101 },
      { ...base, messageIndex: 3 },
      { ...base, previousChainLength: 2 },
      { ...base, senderDeviceId: "device-x" },
      { ...base, targetDeviceId: "device-y" },
      { ...base, ratchetPublicKey: "AC" },
    ];
    for (const mutant of mutants) {
      expect(envelopeAadHex(mutant)).not.toBe(baseline);
    }
  });
});
