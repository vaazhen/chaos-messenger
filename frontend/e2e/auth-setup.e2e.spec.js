import { expect, test } from "@playwright/test";
import path from "node:path";

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function mockApi(page, state = {}) {
  state.calls ??= [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/^\/api/, "");
    const method = request.method();

    state.calls.push({ method, pathname, url: url.toString() });

    if (pathname === "/v1/i18n/messages") {
      return route.fulfill(json({}));
    }

    if (pathname === "/i18n/locale") {
      return route.fulfill(json({ ok: true }));
    }

    if (pathname === "/auth/login" && method === "POST") {
      return route.fulfill(json({
        status: "ok",
        exists: true,
        isNewUser: false,
        userId: 1,
        username: "alice",
        email: "alice@test.com",
        token: "jwt-login",
        refreshToken: "refresh-login",
        deviceRegistrationToken: "device-reg-login",
      }));
    }

    if (pathname === "/auth/send-code" && method === "POST") {
      return route.fulfill(json({
        sent: true,
        phone: "+79001234567",
      }));
    }

    if (pathname === "/auth/verify-code" && method === "POST") {
      return route.fulfill(json({
        status: "ok",
        exists: false,
        isNewUser: true,
        phone: "+79001234567",
        setupToken: "setup-token-phone",
      }));
    }

    if (pathname === "/auth/username-available") {
      return route.fulfill(json({
        username: url.searchParams.get("username"),
        valid: true,
        available: true,
      }));
    }

    if (pathname === "/auth/complete-setup" && method === "POST") {
      return route.fulfill(json({
        status: "ok",
        exists: true,
        isNewUser: false,
        userId: 1,
        username: "alice_setup",
        email: null,
        token: "jwt-setup",
        refreshToken: "refresh-setup",
        deviceRegistrationToken: "device-reg-setup",
      }));
    }

    if (pathname === "/auth/refresh" && method === "POST") {
      state.refreshCount = (state.refreshCount || 0) + 1;

      if (state.refreshCount === 1 && state.forceDeviceRecovery) {
        return route.fulfill(json({
          token: "jwt-refresh-1",
          refreshToken: "refresh-new-1",
        }));
      }

      return route.fulfill(json({
        token: "jwt-refresh-2",
        refreshToken: "refresh-new-2",
        deviceRegistrationToken: "device-reg-refresh",
      }));
    }

    if (pathname === "/crypto/devices/register" && method === "POST") {
      state.deviceRegisterCount = (state.deviceRegisterCount || 0) + 1;
      return route.fulfill(json({
        deviceId: "device-e2e",
        serverDeviceInternalId: 10,
      }));
    }

    if (pathname === "/crypto/devices/current") {
      state.currentDeviceCount = (state.currentDeviceCount || 0) + 1;

      if (state.forceDeviceRecovery && state.currentDeviceCount === 1) {
        return route.fulfill(json({ message: "device is not registered" }, 401));
      }

      return route.fulfill(json({
        deviceId: "device-e2e",
        serverDeviceInternalId: 10,
      }));
    }

    if (pathname === "/users/me") {
      return route.fulfill(json({
        id: 1,
        username: state.meUsername || "alice",
        email: "alice@test.com",
        firstName: "Alice",
        lastName: "E2E",
        avatarUrl: "",
        publicKey: null,
      }));
    }

    if (pathname === "/chats/my") {
      return route.fulfill(json([]));
    }

    return route.fulfill(json({
      message: `Unhandled mocked API route: ${method} ${pathname}`,
    }, 500));
  });
}

test.describe("auth/setup browser flow", () => {
  test("email login creates token, registers device and enters messenger", async ({ page }) => {
    const state = {};
    await mockApi(page, state);

    await page.goto("/");

    await page.getByPlaceholder("you@example.com").fill("alice@test.com");
    await page.locator('input[type="password"]').fill("secret123");
    await page.getByRole("button", { name: /Sign in/i }).click();

    await expect(page.getByText(/Чаты|Chats/i)).toBeVisible();

    await expect.poll(async () => page.evaluate(() => localStorage.getItem("cm_token"))).toBe("jwt-login");
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("cm_refresh_token"))).toBe("refresh-login");

    expect(state.calls.some(c => c.pathname === "/auth/login")).toBeTruthy();
    expect(state.calls.some(c => c.pathname === "/crypto/devices/register")).toBeTruthy();
    expect(state.calls.some(c => c.pathname === "/users/me")).toBeTruthy();
    expect(state.calls.some(c => c.pathname === "/chats/my")).toBeTruthy();
  });

  test("phone OTP setup uploads avatar, completes profile and enters messenger without reload", async ({ page }) => {
    const state = { meUsername: "alice_setup" };
    await mockApi(page, state);

    await page.goto("/");

    await page.getByRole("button", { name: /Phone|Телефон/i }).click();
    await page.getByPlaceholder("999 000 00 00").fill("9001234567");
    await page.getByRole("button", { name: /Get code|Получить код|Отправить код/i }).click();

    await expect(page.getByText(/Enter the code|Введите код/i)).toBeVisible();

    const otp = page.locator(".otp-box");
    for (const digit of ["1", "2", "3", "4", "5", "6"]) {
      await otp.nth(Number(digit) - 1).fill(digit);
    }

    await expect(page.getByText(/Tell us about yourself|Расскажите о себе/i)).toBeVisible();

    const avatarPath = path.resolve("e2e/fixtures/avatar.png");
    await page.locator('input[type="file"]').setInputFiles(avatarPath);

    await page.getByPlaceholder("John").fill("Alice");
    await page.getByPlaceholder("Smith").fill("Setup");
    await page.getByPlaceholder("ivan_petrov").fill("alice_setup");

    await expect(page.getByText(/Available/)).toBeVisible();

    await page.getByRole("button", { name: /Enter messenger/ }).click();

    await expect(page.getByText(/Чаты|Chats/i)).toBeVisible();

    await expect.poll(async () => page.evaluate(() => localStorage.getItem("cm_token"))).toBe("jwt-setup");
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("cm_refresh_token"))).toBe("refresh-setup");

    expect(state.calls.some(c => c.pathname === "/auth/verify-code")).toBeTruthy();
    expect(state.calls.some(c => c.pathname === "/auth/complete-setup")).toBeTruthy();
    expect(state.calls.some(c => c.pathname === "/crypto/devices/register")).toBeTruthy();
    expect(state.calls.some(c => c.pathname === "/users/me")).toBeTruthy();
  });

  test("refresh recovery re-registers missing current device and restores session", async ({ page }) => {
    const state = {
      forceDeviceRecovery: true,
      meUsername: "alice",
    };

    await mockApi(page, state);

    await page.addInitScript(() => {
      localStorage.setItem("cm_refresh_token", "refresh-old");
      localStorage.setItem("cm_device_id", "device-e2e");
    });

    await page.goto("/");

    await expect(page.getByText(/Чаты|Chats/i)).toBeVisible();

    expect(state.refreshCount).toBeGreaterThanOrEqual(2);
    expect(state.deviceRegisterCount).toBeGreaterThanOrEqual(1);
    expect(state.currentDeviceCount).toBeGreaterThanOrEqual(2);

    await expect.poll(async () => page.evaluate(() => localStorage.getItem("cm_token"))).toBe("jwt-refresh-2");
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("cm_refresh_token"))).toBe("refresh-new-2");
  });
});