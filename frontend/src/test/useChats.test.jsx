import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  api: {
    getChats: vi.fn(),
  },
}));

vi.mock("../api", () => ({
  api: mocks.api,
}));

vi.mock("../deviceId", () => ({
  getOrCreateDeviceId: vi.fn(() => "device-a"),
}));

describe("useChats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("loads chats, maps backend shape and clears loading flag", async () => {
    const { useChats } = await import("../hooks/useChats");

    mocks.api.getChats.mockResolvedValueOnce([
      {
        chatId: 100,
        type: "DIRECT",
        otherUsername: "bob",
        otherFirstName: "Bob",
        otherLastName: "Brown",
        unreadCount: 2,
        lastMessageId: 500,
        lastMessageAt: "2026-04-28T10:00:00.000Z",
        lastMessageSenderId: 2,
      },
    ]);

    const { result } = renderHook(() => useChats(1));

    await act(async () => {
      await result.current.loadChats();
    });

    expect(result.current.loadingChats).toBe(false);
    expect(result.current.chats).toHaveLength(1);
    expect(result.current.chats[0]).toMatchObject({
      id: 100,
      type: "direct",
      name: "Bob Brown",
      username: "bob",
      unread: 2,
      lastMessageId: 500,
      lastOut: false,
    });
  });

  it("selectChat sets active id and resets unread counter", async () => {
    const { useChats } = await import("../hooks/useChats");

    mocks.api.getChats.mockResolvedValueOnce([
      { chatId: 100, type: "DIRECT", otherUsername: "bob", unreadCount: 5 },
    ]);

    const { result } = renderHook(() => useChats(1));

    await act(async () => {
      await result.current.loadChats();
    });

    act(() => {
      result.current.selectChat(100);
    });

    expect(result.current.activeId).toBe(100);
    expect(result.current.chats[0].unread).toBe(0);
  });

  it("updateChatPreview updates preview, increments unread and sorts by activity", async () => {
    const { useChats } = await import("../hooks/useChats");

    mocks.api.getChats.mockResolvedValueOnce([
      { chatId: 100, type: "DIRECT", otherUsername: "old", unreadCount: 0, lastMessageAt: "2026-04-27T10:00:00.000Z" },
      { chatId: 200, type: "DIRECT", otherUsername: "new", unreadCount: 1, lastMessageAt: "2026-04-26T10:00:00.000Z" },
    ]);

    const { result } = renderHook(() => useChats(1));

    await act(async () => {
      await result.current.loadChats();
    });

    act(() => {
      result.current.updateChatPreview(
        200,
        "hello",
        false,
        "2026-04-28T12:00:00.000Z",
        true
      );
    });

    expect(result.current.chats[0].id).toBe(200);
    expect(result.current.chats[0].preview).toBe("hello");
    expect(result.current.chats[0].unread).toBe(2);
    expect(result.current.chats[0].lastOut).toBe(false);
  });

  it("markChatOnlineStatus updates matching username only", async () => {
    const { useChats } = await import("../hooks/useChats");

    mocks.api.getChats.mockResolvedValueOnce([
      { chatId: 100, type: "DIRECT", otherUsername: "bob" },
      { chatId: 200, type: "DIRECT", otherUsername: "kate" },
    ]);

    const { result } = renderHook(() => useChats(1));

    await act(async () => {
      await result.current.loadChats();
    });

    act(() => {
      result.current.markChatOnlineStatus("bob", true);
    });

    expect(result.current.chats.find(c => c.username === "bob").online).toBe(true);
    expect(result.current.chats.find(c => c.username === "kate").online).toBe(false);
  });
});