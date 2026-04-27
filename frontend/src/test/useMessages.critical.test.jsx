import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  api: {
    getMessages: vi.fn(),
    markRead: vi.fn(),
    markDelivered: vi.fn(),
    toggleReaction: vi.fn(),
    deleteMsg: vi.fn(),
  },
  call: vi.fn(),
  getToken: vi.fn(() => "jwt-token"),
  getOrCreateDeviceId: vi.fn(() => "device-a"),
  saveMessagePreview: vi.fn(),
}));

vi.mock("../api", () => ({
  api: mocks.api,
  call: mocks.call,
  getToken: mocks.getToken,
  API_BASE: "http://localhost:8080/api",
}));

vi.mock("../deviceId", () => ({
  getOrCreateDeviceId: mocks.getOrCreateDeviceId,
}));

vi.mock("../previewCache", () => ({
  saveMessagePreview: mocks.saveMessagePreview,
}));

describe("useMessages critical flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    delete window.e2ee;

    mocks.api.markRead.mockResolvedValue({});
    mocks.api.markDelivered.mockResolvedValue({});
    mocks.api.deleteMsg.mockResolvedValue({});
    mocks.api.toggleReaction.mockResolvedValue({
      messageId: 500,
      reactions: { "👍": 1 },
      actorUserId: 1,
      emoji: "👍",
      active: true,
    });
  });

  it("loadMessages decrypts timeline, filters locally hidden messages and writes previews", async () => {
    const { useMessages } = await import("../hooks/useMessages");

    localStorage.setItem("cm_hidden_message_ids:1", JSON.stringify(["999"]));

    window.e2ee = {
      decryptEnvelope: vi.fn(async () => JSON.stringify({
        v: 1,
        type: "image",
        text: "photo text",
        image: { dataUrl: "data:image/png;base64,abc" },
      })),
    };

    mocks.api.getMessages.mockResolvedValueOnce([
      {
        id: 500,
        chatId: 100,
        senderId: 2,
        createdAt: "2026-04-28T10:00:00.000Z",
        content: "[encrypted]",
        envelope: { ciphertext: "cipher", nonce: "nonce" },
      },
      {
        id: 999,
        chatId: 100,
        senderId: 2,
        createdAt: "2026-04-28T10:01:00.000Z",
        content: "hidden",
      },
    ]);

    const { result } = renderHook(() => useMessages(1));

    await act(async () => {
      await result.current.loadMessages(100);
    });

    expect(window.e2ee.decryptEnvelope).toHaveBeenCalled();
    expect(result.current.msgs[100]).toHaveLength(1);
    expect(result.current.msgs[100][0]).toMatchObject({
      id: 500,
      _text: "photo text",
      _img: "data:image/png;base64,abc",
      _out: false,
    });

    expect(mocks.api.markRead).toHaveBeenCalledWith(100);
    expect(mocks.api.markDelivered).toHaveBeenCalledWith(100);
    expect(mocks.saveMessagePreview).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      chatId: 100,
      messageId: 500,
      preview: "📷 photo text",
      isOut: false,
    }));
  });

  it("handleIncomingEvent decrypts websocket event and replaces matching optimistic temp message", async () => {
    const { useMessages } = await import("../hooks/useMessages");

    window.e2ee = {
      decryptEnvelope: vi.fn(async () => "hello from websocket"),
    };

    const { result } = renderHook(() => useMessages(1));

    act(() => {
      result.current.setMsgs({
        100: [
          {
            id: "tmp_1",
            _temp: true,
            _clientMessageId: "client-1",
            _out: true,
            _text: "hello",
          },
        ],
      });
    });

    let eventResult;

    await act(async () => {
      eventResult = await result.current.handleIncomingEvent({
        type: "MESSAGE_CREATED",
        messageId: 700,
        chatId: 100,
        clientMessageId: "client-1",
        senderId: 1,
        senderDeviceId: "device-a",
        createdAt: "2026-04-28T10:00:00.000Z",
        status: "SENT",
        envelope: { ciphertext: "cipher", nonce: "nonce" },
      }, 100);
    });

    expect(eventResult).toMatchObject({
      isOut: true,
      text: "hello from websocket",
      messageId: 700,
    });

    expect(result.current.msgs[100]).toHaveLength(1);
    expect(result.current.msgs[100][0]).toMatchObject({
      id: 700,
      _text: "hello from websocket",
      _out: true,
    });
    expect(result.current.msgs[100][0]._temp).not.toBe(true);
  });

  it("handleIncomingEvent applies reaction events and updates myReactions for own actor id", async () => {
    const { useMessages } = await import("../hooks/useMessages");

    const { result } = renderHook(() => useMessages(1));

    act(() => {
      result.current.setMsgs({
        100: [
          { id: 500, _text: "hello", reactions: {}, myReactions: [] },
        ],
      });
    });

    await act(async () => {
      await result.current.handleIncomingEvent({
        type: "MESSAGE_REACTION",
        messageId: 500,
        actorUserId: 1,
        emoji: "👍",
        active: true,
        reactions: { "👍": 1 },
      }, 100);
    });

    expect(result.current.msgs[100][0].reactions).toEqual({ "👍": 1 });
    expect(result.current.msgs[100][0].myReactions).toEqual(["👍"]);
  });

  it("handleIncomingEvent removes deleted message", async () => {
    const { useMessages } = await import("../hooks/useMessages");

    const { result } = renderHook(() => useMessages(1));

    act(() => {
      result.current.setMsgs({
        100: [
          { id: 500, _text: "delete me" },
          { id: 501, _text: "keep me" },
        ],
      });
    });

    await act(async () => {
      await result.current.handleIncomingEvent({
        type: "MESSAGE_DELETED",
        messageId: 500,
      }, 100);
    });

    expect(result.current.msgs[100]).toHaveLength(1);
    expect(result.current.msgs[100][0].id).toBe(501);
  });

  it("sendMessage creates optimistic message, builds fanout and replaces temp id after backend success", async () => {
    const { useMessages } = await import("../hooks/useMessages");

    window.e2ee = {
      buildFanoutRequest: vi.fn(async () => ({
        chatId: 100,
        senderDeviceId: "device-a",
        envelopes: [{ targetDeviceId: "device-b", ciphertext: "cipher" }],
      })),
    };

    mocks.call.mockResolvedValueOnce({
      messageId: 700,
      status: "SENT",
      createdAt: "2026-04-28T10:00:00.000Z",
    });

    const { result } = renderHook(() => useMessages(1));

    let response;

    await act(async () => {
      response = await result.current.sendMessage(100, "hello");
    });

    expect(response.preview).toBe("hello");
    expect(window.e2ee.buildFanoutRequest).toHaveBeenCalledWith(
      expect.any(Function),
      100,
      "hello"
    );

    expect(mocks.call).toHaveBeenCalledWith("/messages/encrypted/v2", expect.objectContaining({
      method: "POST",
      body: expect.any(String),
    }));

    const body = JSON.parse(mocks.call.mock.calls[0][1].body);
    expect(body).toMatchObject({
      chatId: 100,
      senderDeviceId: "device-a",
      envelopes: [{ targetDeviceId: "device-b", ciphertext: "cipher" }],
    });
    expect(body.clientMessageId).toMatch(/^tmp_/);

    expect(result.current.msgs[100]).toHaveLength(1);
    expect(result.current.msgs[100][0]).toMatchObject({
      id: 700,
      _temp: false,
      status: "SENT",
      _text: "hello",
    });
  });

  it("sendMessage removes optimistic message when backend call fails", async () => {
    const { useMessages } = await import("../hooks/useMessages");

    window.e2ee = {
      buildFanoutRequest: vi.fn(async () => ({
        chatId: 100,
        senderDeviceId: "device-a",
        envelopes: [],
      })),
    };

    mocks.call.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useMessages(1));

    let response;

    await act(async () => {
      response = await result.current.sendMessage(100, "hello");
    });

    expect(response).toBeNull();
    expect(result.current.msgs[100]).toEqual([]);
  });

  it("sendMessage returns null when crypto engine is missing", async () => {
    const { useMessages } = await import("../hooks/useMessages");

    const { result } = renderHook(() => useMessages(1));

    let response;

    await act(async () => {
      response = await result.current.sendMessage(100, "hello");
    });

    expect(response).toBeNull();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("editMessage updates optimistically and rolls back on backend failure", async () => {
    const { useMessages } = await import("../hooks/useMessages");

    window.e2ee = {
      buildFanoutRequest: vi.fn(async () => ({
        senderDeviceId: "device-a",
        envelopes: [],
      })),
    };

    mocks.call.mockRejectedValueOnce(new Error("edit failed"));

    const { result } = renderHook(() => useMessages(1));

    const original = {
      id: 500,
      _text: "old text",
      content: "old text",
      version: 1,
      _out: true,
    };

    act(() => {
      result.current.setMsgs({ 100: [original] });
    });

    let response;

    await act(async () => {
      response = await result.current.editMessage(100, original, "new text");
    });

    expect(response).toBeNull();
    expect(result.current.msgs[100][0]).toMatchObject({
      id: 500,
      _text: "old text",
      content: "old text",
      version: 1,
    });
  });

  it("deleteMessage hides local-only deletion and calls backend for everyone deletion", async () => {
    const { useMessages } = await import("../hooks/useMessages");

    const { result } = renderHook(() => useMessages(1));

    act(() => {
      result.current.setMsgs({
        100: [
          { id: 500, _text: "local" },
          { id: 501, _text: "everyone" },
        ],
      });
    });

    act(() => {
      result.current.deleteMessage(100, { id: 500 }, "me");
    });

    expect(result.current.msgs[100].map(m => m.id)).toEqual([501]);
    expect(JSON.parse(localStorage.getItem("cm_hidden_message_ids:1"))).toEqual(["500"]);
    expect(mocks.api.deleteMsg).not.toHaveBeenCalled();

    act(() => {
      result.current.deleteMessage(100, { id: 501 }, "everyone");
    });

    expect(result.current.msgs[100]).toEqual([]);
    expect(mocks.api.deleteMsg).toHaveBeenCalledWith(501);
  });

  it("toggleReaction applies optimistic update and then backend event", async () => {
    const { useMessages } = await import("../hooks/useMessages");

    const { result } = renderHook(() => useMessages(1));

    const msg = {
      id: 500,
      _text: "hello",
      reactions: {},
      myReactions: [],
    };

    act(() => {
      result.current.setMsgs({ 100: [msg] });
    });

    await act(async () => {
      await result.current.toggleReaction(100, msg, "👍");
    });

    expect(mocks.api.toggleReaction).toHaveBeenCalledWith(500, "👍");
    expect(result.current.msgs[100][0].reactions).toEqual({ "👍": 1 });
    expect(result.current.msgs[100][0].myReactions).toEqual(["👍"]);
  });
});