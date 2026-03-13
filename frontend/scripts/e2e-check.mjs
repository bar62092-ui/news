import { chromium } from "playwright";

const target = process.env.WORLD_WATCH_E2E_URL || "http://127.0.0.1:5173";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

try {
  await page.goto(target, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByRole("heading", { name: /World Watch/i }).waitFor({ timeout: 10000 });
  await page.locator(".signal-row, .mini-signal-row").filter({ hasText: /Brasil|Brazil/i }).first().click();
  await page.getByRole("heading", { name: /Brasil|Brazil/i }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(5000);
  const routeValues = await page.locator(".metric-card strong").allTextContents();
  if (!routeValues.length || Number(routeValues[1] || 0) <= 0 || Number(routeValues[2] || 0) <= 0) {
    throw new Error(`Route counts were not populated: ${routeValues.join(",")}`);
  }
  await page.locator(".news-body").first().waitFor({ timeout: 10000 });
  await page.getByText(/Notícias recentes/i).waitFor({ timeout: 10000 });
  await page.screenshot({ path: "output/playwright/world-watch-home.png", fullPage: true });
} finally {
  await browser.close();
}
