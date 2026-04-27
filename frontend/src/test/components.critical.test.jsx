import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../deviceId", () => ({
  getOrCreateDeviceId: vi.fn(() => "device-a"),
}));

describe("critical UI components", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("ChatList filters, searches, selects chat and triggers actions", async () => {
    const { default: ChatList } = await import("../components/ChatList");

    const onSelectChat = vi.fn();
    const onSearch = vi.fn();
    const onNewChat = vi.fn();
    const onFilterChange = vi.fn();
    const onOpenSettings = vi.fn();
    const onMarkAllRead = vi.fn();

    const chats = [
      {
        id: 100,
        type: "direct",
        name: "Bob Brown",
        username: "bob",
        preview: "hello",
        unread: 2,
        time: "10:00",
        colorIdx: 1,
        lastActivityAt: "2026-04-28T10:00:00.000Z",
      },
      {
        id: 200,
        type: "group",
        name: "Team",
        username: "",
        preview: "deploy",
        unread: 0,
        members: 3,
        time: "09:00",
        colorIdx: 2,
        lastActivityAt: "2026-04-28T09:00:00.000Z",
      },
    ];

    render(
      <ChatList
        me={{ id: 1, username: "alice", firstName: "Alice" }}
        chats={chats}
        activeId={100}
        search=""
        filter="all"
        onSelectChat={onSelectChat}
        onПоиск={onSearch}
        onNewChat={onNewChat}
        onFilterChange={onFilterChange}
        onOpenНастройки={onOpenSettings}
        onMarkAllRead={onMarkAllRead}
      />
    );

    expect(screen.getByText("Bob Brown")).toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Team"));
    expect(onSelectChat).toHaveBeenCalledWith(200);

    fireEvent.change(screen.getByPlaceholderText("Поиск"), {
      target: { value: "bob" },
    });
    expect(onSearch).toHaveBeenLastCalledWith("bob");

    fireEvent.click(screen.getByTitle("Новый чат"));
    expect(onNewChat).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("Настройки"));
    expect(onOpenSettings).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("Фильтры"));
    fireEvent.click(screen.getByText("Непрочитанные"));
    expect(onFilterChange).toHaveBeenCalledWith("unread");

    fireEvent.click(screen.getByTitle("Фильтры"));
    fireEvent.click(screen.getByText("Прочитать все"));
    expect(onMarkAllRead).toHaveBeenCalled();
  });

  it("MessageInput sends text, supports reply cancel, typing callback and emoji picker", async () => {
    const { default: MessageInput } = await import("../components/MessageInput");

    const onSend = vi.fn();
    const onTyping = vi.fn();
    const onCancelReply = vi.fn();

    vi.useFakeTimers();

    render(
      <MessageInput
        onSend={onSend}
        replyTo={{ _text: "old message" }}
        onОтменаОтветить={onCancelReply}
        onTyping={onTyping}
      />
    );

    expect(screen.getByText("Ответить")).toBeInTheDocument();
    expect(screen.getByText("old message")).toBeInTheDocument();

    fireEvent.click(screen.getByText("×"));
    expect(onCancelReply).toHaveBeenCalled();

    const textarea = screen.getByPlaceholderText("Сообщение...");

    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(onTyping).toHaveBeenCalledTimes(1);

    fireEvent.change(textarea, { target: { value: "hello world" } });
    expect(onTyping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2100);

    fireEvent.change(textarea, { target: { value: "hello world!" } });
    expect(onTyping).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText("😊"));
    expect(screen.getByTitle("Smileys")).toBeInTheDocument();

    fireEvent.click(screen.getByText("😀"));
    expect(localStorage.getItem("cm_recent_emojis")).toContain("😀");

    fireEvent.click(screen.getByText("➤"));

    expect(onSend).toHaveBeenCalledWith({
      text: "hello world!😀",
      imgFile: null,
      replyTo: { _text: "old message" },
    });
  });

  it("MessageList renders empty/loading states, reactions, search highlight and callbacks", async () => {
    const { default: MessageList } = await import("../components/MessageList");

    const onContextMenu = vi.fn();
    const onReact = vi.fn();

    const { rerender } = render(
      <MessageList
        msgs={[]}
        me={{ id: 1, username: "alice" }}
        activeChat={{ name: "Bob" }}
        loadingMsgs={true}
        onContextMenu={onContextMenu}
        onReact={onReact}
      />
    );

    expect(document.querySelector(".spinner")).toBeInTheDocument();

    rerender(
      <MessageList
        msgs={[]}
        me={{ id: 1, username: "alice" }}
        activeChat={{ name: "Bob" }}
        loadingMsgs={false}
        onContextMenu={onContextMenu}
        onReact={onReact}
      />
    );

    expect(screen.getByText("Нет сообщений")).toBeInTheDocument();

    const messages = [
      {
        id: 500,
        senderId: 1,
        _out: true,
        _text: "hello world",
        createdAt: "2026-04-28T10:00:00.000Z",
        status: "READ",
        reactions: { "👍": 2 },
        myReactions: ["👍"],
      },
      {
        id: 501,
        senderId: 2,
        _out: false,
        _text: "incoming text",
        createdAt: "2026-04-28T10:01:00.000Z",
        reactions: {},
        myReactions: [],
      },
    ];

    rerender(
      <MessageList
        msgs={messages}
        me={{ id: 1, username: "alice" }}
        activeChat={{ name: "Bob", colorIdx: 2 }}
        loadingMsgs={false}
        onContextMenu={onContextMenu}
        onReact={onReact}
        searchQuery="world"
        typingUsername="Bob"
      />
    );

    expect(screen.getAllByText("hello").length).toBeGreaterThan(0);
    expect(screen.getByText("world")).toBeInTheDocument();
    expect(screen.getByText("✓✓")).toBeInTheDocument();

    const reactionButton = screen.getByRole("button", { name: /👍/ });
    fireEvent.click(reactionButton);

    expect(onReact).toHaveBeenCalledWith(
      expect.objectContaining({ id: 500, _text: "hello world", _out: true }),
      "👍"
    );

    const bubble = screen.getByText("incoming text").closest(".msg-wrap");
    fireEvent.contextMenu(bubble);

    expect(onContextMenu).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ id: 501, _text: "incoming text", _out: false })
    );

    expect(document.querySelector(".typing")).toBeInTheDocument();
  });
});