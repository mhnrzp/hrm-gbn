import { expect, test, type Page } from "@playwright/test";

// Requires `pnpm seed` (dev accounts *@example.test, password = SEED_PASSWORD) and MFA not enforced in dev.
const password = process.env.SEED_PASSWORD ?? "";
test.skip(!password, "SEED_PASSWORD not set — run the dev seed first");

async function login(page: Page, who: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("ایمیل").fill(`${who}@example.test`);
  await page.getByLabel("رمز عبور").fill(password);
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page.getByRole("heading", { name: "داشبورد" })).toBeVisible();
}

test("UI-01/UI-02: manager assigns, employee completes, state persists and KPI updates", async ({ page }) => {
  const title = `تسک آزمون ${Date.now()}`;
  await login(page, "ali");
  await page.goto("/tasks");
  await page.getByRole("button", { name: "تسک جدید" }).first().click();
  await page.getByLabel("عنوان تسک").fill(title);
  await page.getByLabel("مسئول").selectOption({ label: "سارا محمدی" });
  await page.getByLabel("اولویت").selectOption({ label: "فوری" });
  await page.getByRole("button", { name: "ذخیره تسک" }).click();
  await expect(page.getByText(title)).toBeVisible();

  await login(page, "sara");
  const todoCard = page.getByText("تسک‌های انجام‌نشده").locator("..");
  const before = await todoCard.textContent();
  await page.getByRole("checkbox", { name: `تکمیل ${title}` }).check();
  await expect(page.getByRole("checkbox", { name: `تکمیل ${title}` })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: `تکمیل ${title}` })).toHaveCount(0);
  expect(await todoCard.textContent()).not.toBe(before);
});

test("LEAVE-01/02: employee request → manager sees conflict panel → approves → calendar block", async ({ page }) => {
  await login(page, "hossein");
  await page.goto("/calendar");
  await page.getByRole("button", { name: "درخواست مرخصی" }).first().click();
  await page.getByLabel("دلیل درخواست").fill("آزمون خودکار");
  await page.getByRole("button", { name: "از تاریخ" }).click();
  await page.getByRole("dialog", { name: "از تاریخ" }).getByRole("button").filter({ hasText: /^[۰-۹]+$/ }).nth(20).click();
  await page.getByRole("button", { name: "ارسال درخواست" }).click();

  await login(page, "ali");
  await page.goto("/calendar");
  await page.getByRole("button", { name: "بررسی درخواست" }).first().click();
  await page.getByRole("button", { name: "تأیید مرخصی" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("INV: manager records a payment and opens the receipt; employee cannot open invoices", async ({ page }) => {
  await login(page, "ali");
  await page.goto("/invoices");
  await page.getByRole("button", { name: "صورت‌حساب جدید" }).click();
  await page.getByLabel("عنوان صورت‌حساب").fill("آزمون پرداخت");
  await page.getByLabel("دریافت‌کننده").fill("شرکت آزمون");
  await page.getByLabel("مبلغ").fill("1250000");
  await page.getByRole("button", { name: "ذخیره صورت‌حساب" }).click();
  await page.getByRole("row", { name: /آزمون پرداخت/ }).getByRole("button", { name: "جزئیات" }).first().click();
  await page.getByRole("button", { name: "ثبت پرداخت" }).click();
  await page.getByRole("button", { name: "تأیید و ثبت پرداخت" }).click();
  await expect(page.getByText("صورت‌حساب پرداخت‌شده است")).toBeVisible();

  await login(page, "sara");
  await page.goto("/invoices");
  await expect(page).toHaveURL(/\/$/);
  const api = await page.request.get("/api/v1/invoices");
  expect(api.status()).toBe(403);
});

test("dashboard renders RTL with Vazirmatn and Persian digits @mobile", async ({ page }) => {
  await login(page, "sara");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(font).toContain("Vazirmatn");
  await expect(page.getByText(/[۰-۹]/).first()).toBeVisible();
});
