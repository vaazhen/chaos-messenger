import { describe, it, expect } from "vitest";
import { getTime, mapChat } from "../helpers";

describe("getTime", () => {
  it("returns a string for a valid ISO date", () => {
    const result = getTime("2024-01-15T10:30:00");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a string for current time when no arg", () => {
    const result = getTime();
    expect(typeof result).toBe("string");
  });
});

describe("mapChat", () => {
  it("maps a DIRECT chat correctly", () => {
    const raw = {
      chatId: 1,
      type: "DIRECT",
      otherUserId: 42,
      otherUserFirstName: "Alice",
      otherUserLastName: "Smith",
      lastMessage: "hi",
      lastMessageAt: "2024-01-15T10:00:00",
      unreadCount: 2,
      online: true,
    };
    const mapped = mapChat(raw, 1);
    expect(mapped.id).toBe(1);
    expect(mapped.online).toBe(true);
    expect(mapped.unread).toBe(2);
  });

  it("maps a GROUP chat correctly", () => {
    const raw = {
      chatId: 2,
      type: "GROUP",
      name: "Dev Team",
      participants: [1, 2, 3],
      lastMessage: "hello",
      lastMessageAt: null,
      unreadCount: 0,
      online: false,
    };
    const mapped = mapChat(raw, 1);
    expect(mapped.name).toBe("Dev Team");
    expect(mapped.type).toBe("group");
    expect(mapped.members).toBe(3);
  });
});
