import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const wsMocks = vi.hoisted(() => {
  const clients = [];

  class MockClient {
    constructor(config) {
      this.config = config;
      this.connected = false;
      this.subscriptions = {};
      this.publish = vi.fn();
      this.activate = vi.fn(() => {
        this.connected = true;
        this.onConnect?.();
      });
      this.deactivate = vi.fn(() => {
        this.connected = false;
      });
      this.subscribe = vi.fn((topic, cb) => {
        const sub = { unsubscribe: vi.fn() };
        this.subscriptions[topic] = { cb, sub };
        return sub;
      });
      clients.push(this);
    }
  }

  return {
    clients,
    MockClient,
    getToken: vi.fn(() => "jwt-token"),
    getOrCreateDeviceId: vi.fn(() => "device-a"),
    sockJs: vi.fn(() => ({ socket: true })),
  };
});

vi.mock("@stomp/stompjs", () => ({
  Client: wsMocks.MockClient,
}));

vi.mock("sockjs-client", () => ({
  default: wsMocks.sockJs,
}));

vi.mock("../api", () => ({
  getToken: wsMocks.getToken,
  getCurrentDeviceId: vi.fn(() => "device-a"),
}));

vi.mock("../deviceId", () => ({
  getOrCreateDeviceId: wsMocks.getOrCreateDeviceId,
}));

vi.mock("../config", () => ({
  WS_URL: "http://localhost/ws",
}));

describe("useWebSocket", () => {
  beforeEach(() => {
    wsMocks.clients.length = 0;
    vi.clearAllMocks();
  });

  it("does not connect when disabled, user is missing or JWT is missing", async () => {
    const { default: useWebSocket } = await import("../hooks/useWebSocket");

    renderHook(() => useWebSocket({
      me: { username: "alice" },
      enabled: false,
    }));

    expect(wsMocks.clients).toHaveLength(0);

    renderHook(() => useWebSocket({
      me: null,
      enabled: true,
    }));

    expect(wsMocks.clients).toHaveLength(0);

    wsMocks.getToken.mockReturnValueOnce("");

    renderHook(() => useWebSocket({
      me: { username: "alice" },
      enabled: true,
    }));

    expect(wsMocks.clients).toHaveLength(0);
  });

  it("connects with JWT/device headers, subscribes presence/chats and publishes online", async () => {
    const { default: useWebSocket } = await import("../hooks/useWebSocket");

    const onChatListUpdate = vi.fn();
    const onStatusUpdate = vi.fn();
    const onMessage = vi.fn();
    const onTyping = vi.fn();

    renderHook(() => useWebSocket({
      me: { username: "alice" },
      activeId: 100,
      chatIds: [100, 200],
      onMessage,
      onChatListUpdate,
      onStatusUpdate,
      onTyping,
      enabled: true,
    }));

    const client = wsMocks.clients[0];

    expect(client.config.connectHeaders).toEqual({
      Authorization: "Bearer jwt-token",
      "X-Device-Id": "device-a",
    });

    expect(client.activate).toHaveBeenCalled();
    expect(Object.keys(client.subscriptions)).toEqual(expect.arrayContaining([
      "/topic/user/status",
      "/topic/devices/device-a/status",
      "/topic/users/alice/chats",
      "/topic/devices/device-a/chats/100",
      "/topic/chats/100/typing",
      "/topic/devices/device-a/chats/200",
      "/topic/chats/200/typing",
    ]));

    expect(client.publish).toHaveBeenCalledWith({
      destination: "/app/user.online",
      body: "{}",
    });

    act(() => {
      client.subscriptions["/topic/users/alice/chats"].cb({ body: "{}" });
      client.subscriptions["/topic/user/status"].cb({ body: JSON.stringify({ username: "bob", online: true }) });
      client.subscriptions["/topic/devices/device-a/chats/100"].cb({ body: JSON.stringify({ type: "MESSAGE_CREATED", chatId: 100 }) });
      client.subscriptions["/topic/chats/100/typing"].cb({ body: JSON.stringify({ username: "bob", typing: true }) });
    });

    expect(onChatListUpdate).toHaveBeenCalled();
    expect(onStatusUpdate).toHaveBeenCalledWith({
      type: "user_status",
      username: "bob",
      online: true,
    });
    expect(onMessage).toHaveBeenCalledWith({
      type: "MESSAGE_CREATED",
      chatId: 100,
    }, 100);
    expect(onTyping).toHaveBeenCalledWith({
      username: "bob",
      typing: true,
    }, 100);
  });

  it("updates chat subscriptions on chatIds changes and unsubscribes removed chats", async () => {
    const { default: useWebSocket } = await import("../hooks/useWebSocket");

    const { rerender } = renderHook(
      ({ chatIds }) => useWebSocket({
        me: { username: "alice" },
        chatIds,
        enabled: true,
      }),
      { initialProps: { chatIds: [100, 200] } }
    );

    const client = wsMocks.clients[0];
    const chat100Sub = client.subscriptions["/topic/devices/device-a/chats/100"].sub;
    const typing100Sub = client.subscriptions["/topic/chats/100/typing"].sub;

    rerender({ chatIds: [200, 300] });

    expect(chat100Sub.unsubscribe).toHaveBeenCalled();
    expect(typing100Sub.unsubscribe).toHaveBeenCalled();
    expect(client.subscriptions["/topic/devices/device-a/chats/300"]).toBeTruthy();
    expect(client.subscriptions["/topic/chats/300/typing"]).toBeTruthy();
  });

  it("sendTyping publishes typing event through active client", async () => {
    const { default: useWebSocket } = await import("../hooks/useWebSocket");

    const { result } = renderHook(() => useWebSocket({
      me: { username: "alice" },
      chatIds: [100],
      enabled: true,
    }));

    const client = wsMocks.clients[0];

    act(() => {
      result.current.sendTyping(100);
    });

    expect(client.publish).toHaveBeenCalledWith({
      destination: "/app/typing",
      body: JSON.stringify({ chatId: 100 }),
    });
  });

  it("deactivates websocket on cleanup", async () => {
    const { default: useWebSocket } = await import("../hooks/useWebSocket");

    const { unmount } = renderHook(() => useWebSocket({
      me: { username: "alice" },
      chatIds: [100],
      enabled: true,
    }));

    const client = wsMocks.clients[0];

    unmount();

    expect(client.deactivate).toHaveBeenCalled();
  });
});