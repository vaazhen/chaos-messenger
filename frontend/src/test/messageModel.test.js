import { describe, expect, it } from "vitest";
import {
  adjustReactionSummary,
  buildEditedPayload,
  compactReplyTo,
  envelopeForDecrypt,
  hasRenderablePlaintext,
  isEncryptedPlaceholder,
  mergeIncomingMessage,
  messagePreview,
  parseMessagePayload,
  updateMessageReactions,
  visibleMessageText,
} from "../messageModel";

describe("parseMessagePayload", () => {
  it("keeps empty and encrypted placeholders as text", () => {
    expect(parseMessagePayload("")).toEqual({
      text: "",
      img: null,
      voice: null,
      videoNote: null,
      payload: null,
      attachment: null,
      replyTo: null,
    });
    expect(parseMessagePayload("[encrypted]").text).toBe("[encrypted]");
  });

  it("parses a v1 image payload without recomputing the caption", () => {
    const raw = JSON.stringify({
      v: 1,
      type: "image",
      text: "cape",
      image: { dataUrl: "data:image/png;base64,abc" },
      attachment: { attachmentId: "att-1" },
    });
    const parsed = parseMessagePayload(raw);
    expect(parsed.text).toBe("cape");
    expect(parsed.img).toBe("data:image/png;base64,abc");
    expect(parsed.attachment).toEqual({ attachmentId: "att-1" });
    expect(parsed.payload.type).toBe("image");
  });

  it("rejects remote http image and voice urls from the decrypted payload", () => {
    const image = parseMessagePayload(JSON.stringify({
      v: 1,
      type: "image",
      text: "pic",
      image: { dataUrl: "https://evil.example/track.gif" },
    }));
    expect(image.img).toBeNull();

    const voice = parseMessagePayload(JSON.stringify({
      v: 1,
      type: "voice",
      voice: { dataUrl: "https://evil.example/audio.ogg" },
    }));
    expect(voice.voice).toBeNull();
  });

  it("does not show server content when an envelope is still sealed", () => {
    expect(visibleMessageText({
      envelope: { ciphertext: "c" },
      content: "attacker text",
      _text: "[encrypted]",
    })).toBe("[encrypted]");
  });

  it("treats non-json as ordinary text", () => {
    expect(parseMessagePayload("hello there").text).toBe("hello there");
  });
});

describe("mergeIncomingMessage", () => {
  it("does not overwrite local plaintext with an encrypted placeholder", () => {
    const existing = { content: "hi", _text: "hi", id: 1 };
    const incoming = { content: "[encrypted]", _text: "[encrypted]", id: 1, status: "DELIVERED" };
    const merged = mergeIncomingMessage(existing, incoming);
    expect(merged.content).toBe("hi");
    expect(merged._text).toBe("hi");
    expect(merged.status).toBe("DELIVERED");
  });

  it("replaces when incoming has real content", () => {
    const existing = { content: "old", _text: "old", id: 1 };
    const incoming = { content: "new", _text: "new", id: 1 };
    expect(mergeIncomingMessage(existing, incoming)).toEqual({
      content: "new",
      _text: "new",
      id: 1,
    });
  });
});

describe("placeholders", () => {
  it("detects encrypted placeholders and renderable plaintext", () => {
    expect(isEncryptedPlaceholder({ content: "[encrypted]" })).toBe(true);
    expect(hasRenderablePlaintext({ _text: "ok" })).toBe(true);
    expect(hasRenderablePlaintext({ _text: "[encrypted]" })).toBe(false);
    expect(hasRenderablePlaintext({ _img: "data:image/png;base64,x" })).toBe(true);
  });
});

describe("messagePreview", () => {
  it("uses fixed captions for media kinds", () => {
    expect(messagePreview({ payload: { type: "video_note" } })).toBe("Video message");
    expect(messagePreview({ img: "data:image/png;base64,x" })).toBe("📷 Photo");
    expect(messagePreview({ voice: { transcript: "" }, payload: { type: "voice" } })).toBe("Voice message");
    expect(messagePreview({
      payload: { type: "file" },
      attachment: { attachmentId: "a", fileName: "doc.pdf" },
    })).toBe("📎 doc.pdf");
    expect(messagePreview({ text: "plain" })).toBe("plain");
  });
});

describe("buildEditedPayload", () => {
  it("keeps image payload and replaces only the caption", () => {
    const result = buildEditedPayload({
      _payload: { v: 1, type: "image", text: "old", image: { dataUrl: "data:image/png;base64,x" } },
      _img: "data:image/png;base64,x",
    }, "new caption");
    expect(JSON.parse(result.plaintext)).toMatchObject({ type: "image", text: "new caption" });
    expect(result.parsed.text).toBe("new caption");
    expect(result.parsed.img).toBe("data:image/png;base64,x");
  });

  it("stores a reply as a v1 text envelope", () => {
    const result = buildEditedPayload({
      _replyTo: { id: 9, _text: "orig" },
    }, "answer");
    expect(JSON.parse(result.plaintext)).toEqual({
      v: 1,
      type: "text",
      text: "answer",
      replyTo: { id: 9, _text: "orig" },
    });
  });
});

describe("reactions and envelope helpers", () => {
  it("drops a reaction key when the count hits zero", () => {
    expect(adjustReactionSummary({ "👍": 1 }, "👍", -1)).toEqual({});
    expect(adjustReactionSummary({}, "🔥", 1)).toEqual({ "🔥": 1 });
  });

  it("updates only the matching message and the actor's own reactions", () => {
    const prev = {
      7: [
        { id: 1, reactions: {}, myReactions: [] },
        { id: 2, reactions: {}, myReactions: [] },
      ],
    };
    const next = updateMessageReactions(prev, 7, 1, { "👍": 1 }, 3, "👍", true, 3);
    expect(next[7][0].myReactions).toEqual(["👍"]);
    expect(next[7][1].myReactions).toEqual([]);
  });

  it("binds sender and chat onto a decrypt envelope", () => {
    expect(envelopeForDecrypt({ ciphertext: "x" }, "device-b", 42)).toEqual({
      ciphertext: "x",
      senderDeviceId: "device-b",
      _chatId: 42,
    });
    expect(envelopeForDecrypt({ ciphertext: "x" }, "device-b", 42, 9)).toEqual({
      ciphertext: "x",
      senderDeviceId: "device-b",
      _chatId: 42,
      _senderUserId: 9,
    });
  });

  it("compacts a reply to the fields the wire format keeps", () => {
    expect(compactReplyTo({
      id: 5,
      _text: "a".repeat(600),
      _img: "data:image/png;base64,x",
      _voice: { dataUrl: "x" },
      extra: "drop",
    })).toEqual({
      id: 5,
      _text: "a".repeat(500),
      _img: true,
      _voice: true,
      _videoNote: false,
    });
  });
});
