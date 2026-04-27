import { expect, test } from "@playwright/test";

const PASSWORD = "secret123";

function uniqueSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function user(prefix, suffix) {
  const username = `e2e_${prefix}_${suffix}`.toLowerCase();

  return {
    username,
    email: `${username}@example.com`,
    firstName: prefix === "alice" ? "Alice" : "Bob",
    lastName: "RealE2E",
    displayName: `${prefix === "alice" ? "Alice" : "Bob"} RealE2E`,
  };
}

async function ensureBackendIsAlive(request) {
  const response = await request.get("http://127.0.0.1:8080/actuator/health", {
    timeout: 10_000,
  });

  expect(
    response.ok(),
    "Backend is not alive. Start backend first: docker compose -f backend/docker-compose.dev.yml up -d, then mvn spring-boot:run with SPRING_PROFILES_ACTIVE=dev and JWT_SECRET."
  ).toBeTruthy();
}

async function registerEmailUser(page, data) {
  await page.goto("/");

  await page.getByPlaceholder("you@example.com").fill(data.email);
  await page.locator('input[type="password"]').fill(PASSWORD);

  await page.getByRole("button", { name: /Create account by email/i }).click();
  await page.getByRole("button", { name: /^Create account$|^Создать аккаунт$/i }).click();

  await expect(page.getByText(/Tell us about yourself|Расскажите о себе/i)).toBeVisible();

  await page.getByPlaceholder("John").fill(data.firstName);
  await page.getByPlaceholder("Smith").fill(data.lastName);

  const usernameInput = page.getByPlaceholder("ivan_petrov");
  await expect(usernameInput).toBeVisible();

  await usernameInput.fill(data.username);

  await expect(page.getByText(/Available|Доступ/i)).toBeVisible();

  await page.getByRole("button", { name: /Enter messenger|Войти/i }).click();

  await expect(page.getByText(/Чаты|Chats/i)).toBeVisible();

  await expect.poll(async () => page.evaluate(() => localStorage.getItem("cm_token"))).not.toBeNull();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("cm_refresh_token"))).not.toBeNull();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("cm_device_id"))).not.toBeNull();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("cm_device_bundle_v2"))).not.toBeNull();
}

async function openDirectChat(page, target) {
  await page.getByTitle("Новый чат").click();

  await page.getByPlaceholder("Поиск по username").fill(target.username);

  const row = page.locator(".new-chat-drawer-user").filter({
    hasText: `@${target.username}`,
  });

  await expect(row).toBeVisible();
  await row.click();

  await expect(page.locator(".head-name")).toContainText(target.displayName);
}

async function selectChatByUser(page, target) {
  const chat = page.locator(".conversation-item").filter({
    hasText: target.displayName,
  });

  await expect(chat).toBeVisible();
  await chat.click();

  await expect(page.locator(".head-name")).toContainText(target.displayName);
}

async function sendText(page, text) {
  await page.getByPlaceholder("Сообщение...").fill(text);
  await page.locator(".send-btn").click();
  await expect(page.locator(".msgs")).toContainText(text);
}

test.describe("real backend E2EE integration", () => {
  test.beforeAll(async ({ request }) => {
    await ensureBackendIsAlive(request);
  });

  test("two users exchange encrypted direct message and receiver decrypts after reload", async ({ browser }) => {
    const suffix = uniqueSuffix();

    const alice = user("alice", suffix);
    const bob = user("bob", suffix);

    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    const messageText = `real e2ee hello ${suffix}`;

    await registerEmailUser(alicePage, alice);
    await registerEmailUser(bobPage, bob);

    await openDirectChat(alicePage, bob);
    await sendText(alicePage, messageText);

    await bobPage.reload();

    await expect(bobPage.getByText(/Чаты|Chats/i)).toBeVisible();

    await selectChatByUser(bobPage, alice);

    await expect(bobPage.locator(".msgs")).toContainText(messageText);

    await bobPage.reload();

    await expect(bobPage.getByText(/Чаты|Chats/i)).toBeVisible();

    await selectChatByUser(bobPage, alice);

    await expect(bobPage.locator(".msgs")).toContainText(messageText);

    await aliceContext.close();
    await bobContext.close();
  });
});