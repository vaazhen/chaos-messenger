import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";

const mocks = vi.hoisted(() => ({
  api: {
    searchUsers: vi.fn(),
    createSaved: vi.fn(),
    createDirect: vi.fn(),
    createGroup: vi.fn(),
    updateProfile: vi.fn(),
    listDevices: vi.fn(),
    deactivateDevice: vi.fn(),
  },
  getCurrentDeviceId: vi.fn(() => "device-current"),
}));

vi.mock("../api", () => ({
  api: mocks.api,
  getCurrentDeviceId: mocks.getCurrentDeviceId,
}));

describe("AuthScreen critical UI flow", () => {
  afterEach(() => {
    cleanup();
  });

  it("submits email login and switches to email registration mode", async () => {
    const { default: AuthScreen } = await import("../components/AuthScreen");

    const onSubmitEmail = vi.fn();

    render(
      <AuthScreen
        screen="auth"
        phone=""
        setPhone={vi.fn()}
        dialCode="+7"
        setDialCode={vi.fn()}
        otp={["", "", "", "", "", ""]}
        setOtp={vi.fn()}
        otpRefs={Array.from({ length: 6 }, () => createRef())}
        email="alice@test.com"
        setEmail={vi.fn()}
        password="secret123"
        setPassword={vi.fn()}
        onSubmitPhone={vi.fn()}
        onVerifyOtp={vi.fn()}
        onSubmitEmail={onSubmitEmail}
        loading={false}
        error=""
        onBack={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Sign in"));
    expect(onSubmitEmail).toHaveBeenCalledWith("login");

    fireEvent.click(screen.getByText("Create account by email"));
    fireEvent.click(screen.getByText("Create account"));

    expect(onSubmitEmail).toHaveBeenLastCalledWith("register");
  });

  it("switches to phone mode, sanitizes phone and changes country", async () => {
    const { default: AuthScreen } = await import("../components/AuthScreen");

    const setPhone = vi.fn();
    const setDialCode = vi.fn();
    const onSubmitPhone = vi.fn();

    render(
      <AuthScreen
        screen="auth"
        phone="900"
        setPhone={setPhone}
        dialCode="+7"
        setDialCode={setDialCode}
        otp={["", "", "", "", "", ""]}
        setOtp={vi.fn()}
        otpRefs={Array.from({ length: 6 }, () => createRef())}
        email=""
        setEmail={vi.fn()}
        password=""
        setPassword={vi.fn()}
        onSubmitPhone={onSubmitPhone}
        onVerifyOtp={vi.fn()}
        onSubmitEmail={vi.fn()}
        loading={false}
        error="Ошибка входа"
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText("Ошибка входа")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Phone"));

    const phoneInput = screen.getByPlaceholderText("999 000 00 00");
    fireEvent.change(phoneInput, { target: { value: "+7 (999) abc 123" } });

    expect(setPhone).toHaveBeenCalledWith("7999123");

    fireEvent.keyDown(phoneInput, { key: "Enter" });
    expect(onSubmitPhone).toHaveBeenCalled();

    fireEvent.click(screen.getByText("+7"));
    fireEvent.change(screen.getByPlaceholderText("Search country..."), {
      target: { value: "Germany" },
    });
    fireEvent.click(screen.getByText("Germany"));

    expect(setDialCode).toHaveBeenCalledWith("+49");
    expect(setPhone).toHaveBeenLastCalledWith("");
  });

  it("otp screen updates digit and verifies when six digits are filled", async () => {
    const { default: AuthScreen } = await import("../components/AuthScreen");

    const setOtp = vi.fn();
    const onVerifyOtp = vi.fn();

    render(
      <AuthScreen
        screen="otp"
        phone="9001234567"
        setPhone={vi.fn()}
        dialCode="+7"
        setDialCode={vi.fn()}
        otp={["1", "2", "3", "4", "5", ""]}
        setOtp={setOtp}
        otpRefs={Array.from({ length: 6 }, () => createRef())}
        email=""
        setEmail={vi.fn()}
        password=""
        setPassword={vi.fn()}
        onSubmitPhone={vi.fn()}
        onVerifyOtp={onVerifyOtp}
        onSubmitEmail={vi.fn()}
        loading={true}
        error=""
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText("Enter the code")).toBeInTheDocument();
    expect(document.querySelector(".spinner")).toBeInTheDocument();

    const boxes = document.querySelectorAll(".otp-box");
    fireEvent.change(boxes[5], { target: { value: "6" } });

    expect(setOtp).toHaveBeenCalledWith(["1", "2", "3", "4", "5", "6"]);
    expect(onVerifyOtp).toHaveBeenCalledWith(["1", "2", "3", "4", "5", "6"]);
  });
});

describe("NewChatModal critical UI flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mocks.api.searchUsers.mockResolvedValue([
      {
        id: 2,
        username: "bob",
        firstName: "Bob",
        lastName: "Brown",
        avatarUrl: "",
      },
      {
        id: 1,
        username: "alice",
        firstName: "Alice",
        lastName: "Self",
      },
    ]);

    mocks.api.createSaved.mockResolvedValue({ chatId: 10 });
    mocks.api.createDirect.mockResolvedValue({ chatId: 20 });
    mocks.api.createGroup.mockResolvedValue({ chatId: 30 });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("opens saved chat, searches users and creates direct chat", async () => {
    const { default: NewChatModal } = await import("../components/NewChatModal");

    const onClose = vi.fn();
    const onCreated = vi.fn();

    render(
      <NewChatModal
        me={{ id: 1, username: "alice" }}
        onClose={onClose}
        onCreated={onCreated}
      />
    );

    fireEvent.click(screen.getByText("Избранное"));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.api.createSaved).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith(10);

    fireEvent.change(screen.getByPlaceholderText("Поиск по username"), {
      target: { value: "bo" },
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.api.searchUsers).toHaveBeenCalledWith("bo");
    expect(screen.getByText("Bob Brown")).toBeInTheDocument();
    expect(screen.queryByText("Alice Self")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Bob Brown"));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.api.createDirect).toHaveBeenCalledWith("bob");
    expect(onCreated).toHaveBeenCalledWith(20);

    fireEvent.click(screen.getByText("×"));
    expect(onClose).toHaveBeenCalled();
  });

  it("creates group chat with selected users", async () => {
    const { default: NewChatModal } = await import("../components/NewChatModal");

    const onCreated = vi.fn();

    render(
      <NewChatModal
        me={{ id: 1, username: "alice" }}
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );

    fireEvent.click(screen.getByText("Группа"));

    fireEvent.change(screen.getByPlaceholderText("Команда, семья, проект..."), {
      target: { value: "Project Team" },
    });

    fireEvent.change(screen.getByPlaceholderText("Поиск по username"), {
      target: { value: "bo" },
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText("Bob Brown"));
    expect(screen.getByText("@bob ×")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Создать (1)"));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.api.createGroup).toHaveBeenCalledWith("Project Team", [2]);
    expect(onCreated).toHaveBeenCalledWith(30);
  });

  it("shows search error and no-results state", async () => {
    const { default: NewChatModal } = await import("../components/NewChatModal");

    mocks.api.searchUsers.mockRejectedValueOnce(new Error("search failed"));

    render(
      <NewChatModal
        me={{ id: 1, username: "alice" }}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Поиск по username"), {
      target: { value: "xx" },
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("search failed")).toBeInTheDocument();

    mocks.api.searchUsers.mockResolvedValueOnce([]);

    fireEvent.change(screen.getByPlaceholderText("Поиск по username"), {
      target: { value: "zz" },
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
  });
});

describe("ProfileModal critical UI flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    mocks.getCurrentDeviceId.mockReturnValue("device-current");

    mocks.api.updateProfile.mockResolvedValue({
      id: 1,
      username: "alice",
      firstName: "Alice",
      lastName: "Updated",
      avatarUrl: "",
      token: "jwt-updated",
    });

    mocks.api.listDevices.mockResolvedValue([
      {
        id: 10,
        deviceId: "device-current",
        deviceName: "Current browser",
        active: true,
        current: true,
        lastSeen: "2026-04-28T10:00:00.000Z",
      },
      {
        id: 20,
        deviceId: "device-old",
        deviceName: "Old browser",
        active: true,
        current: false,
        lastSeen: "2026-04-27T10:00:00.000Z",
      },
    ]);

    mocks.api.deactivateDevice.mockResolvedValue({ ok: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("edits profile, saves trimmed payload, stores new token and triggers UI actions", async () => {
    const { default: ProfileModal } = await import("../components/ProfileModal");

    const onSaved = vi.fn();
    const onToggleTheme = vi.fn();
    const onSwitchLang = vi.fn();
    const onLogout = vi.fn();
    const onClose = vi.fn();

    render(
      <ProfileModal
        me={{
          id: 1,
          username: "alice",
          firstName: "Alice",
          lastName: "Smith",
          avatarUrl: "",
        }}
        lang="ru"
        theme="dark"
        onClose={onClose}
        onSaved={onSaved}
        onToggleTheme={onToggleTheme}
        onSwitchLang={onSwitchLang}
        onLogout={onLogout}
      />
    );

    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Имя"), {
      target: { value: "  Alice  " },
    });

    fireEvent.change(screen.getByPlaceholderText("Фамилия"), {
      target: { value: "  Updated  " },
    });

    fireEvent.click(screen.getByText("Оформление"));
    expect(onToggleTheme).toHaveBeenCalled();

    fireEvent.click(screen.getByText("Язык"));
    expect(onSwitchLang).toHaveBeenCalled();

    fireEvent.click(screen.getByText("Сохранить"));

    await waitFor(() => {
      expect(mocks.api.updateProfile).toHaveBeenCalledWith({
        firstName: "Alice",
        lastName: "Updated",
        username: "alice",
        avatarUrl: "",
      });
    });

    expect(localStorage.getItem("cm_token")).toBe("jwt-updated");
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      username: "alice",
      lastName: "Updated",
    }));

    fireEvent.click(screen.getByText("Выйти из аккаунта"));
    expect(onLogout).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("Закрыть"));
    expect(onClose).toHaveBeenCalled();
  });

  it("loads devices and deactivates non-current active device", async () => {
    const { default: ProfileModal } = await import("../components/ProfileModal");

    mocks.api.listDevices
      .mockResolvedValueOnce([
        {
          id: 10,
          deviceId: "device-current",
          deviceName: "Current browser",
          active: true,
          current: true,
          lastSeen: "2026-04-28T10:00:00.000Z",
        },
        {
          id: 20,
          deviceId: "device-old",
          deviceName: "Old browser",
          active: true,
          current: false,
          lastSeen: "2026-04-27T10:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 10,
          deviceId: "device-current",
          deviceName: "Current browser",
          active: true,
          current: true,
          lastSeen: "2026-04-28T10:00:00.000Z",
        },
        {
          id: 20,
          deviceId: "device-old",
          deviceName: "Old browser",
          active: false,
          current: false,
          lastSeen: "2026-04-27T10:00:00.000Z",
        },
      ]);

    render(
      <ProfileModal
        me={{ id: 1, username: "alice", firstName: "Alice" }}
        lang="ru"
        theme="light"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onToggleTheme={vi.fn()}
        onSwitchLang={vi.fn()}
        onLogout={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Устройства"));

    await waitFor(() => {
      expect(mocks.api.listDevices).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Current browser")).toBeInTheDocument();
      expect(screen.getByText("Old browser")).toBeInTheDocument();
      expect(screen.getByText("это устройство")).toBeInTheDocument();
    });

    const disableButtons = screen.getAllByText("Отключить");
    fireEvent.click(disableButtons[0]);

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled();
      expect(mocks.api.deactivateDevice).toHaveBeenCalledWith(20, false);
      expect(mocks.api.listDevices).toHaveBeenCalledTimes(2);
    });
  });

  it("shows profile save error and last-device deactivation error", async () => {
    const { default: ProfileModal } = await import("../components/ProfileModal");

    mocks.api.updateProfile.mockRejectedValueOnce(new Error("profile failed"));
    mocks.api.deactivateDevice.mockRejectedValueOnce(new Error("Cannot deactivate the last active device"));

    mocks.api.listDevices.mockResolvedValue([
      {
        id: 20,
        deviceId: "device-old",
        deviceName: "Old browser",
        active: true,
        current: false,
        lastSeen: "2026-04-27T10:00:00.000Z",
      },
    ]);

    render(
      <ProfileModal
        me={{ id: 1, username: "alice", firstName: "Alice" }}
        lang="en"
        theme="light"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onToggleTheme={vi.fn()}
        onSwitchLang={vi.fn()}
        onLogout={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Сохранить"));

    await waitFor(() => {
      expect(screen.getByText("profile failed")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Устройства"));

    await waitFor(() => {
      expect(screen.getByText("Old browser")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Отключить"));

    await waitFor(() => {
      expect(screen.getByText("Нельзя отключить последнее активное устройство.")).toBeInTheDocument();
    });
  });
});