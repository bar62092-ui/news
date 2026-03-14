import { chromium } from "playwright";

const target = process.env.WORLD_WATCH_E2E_URL || "http://127.0.0.1:5173";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

try {
  await page.goto(target, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByRole("heading", { name: /World Watch/i }).waitFor({ timeout: 10000 });
  await page.locator(".map-canvas").waitFor({ timeout: 10000 });
  await page.locator(".country-pill").first().click();
  await page.getByRole("heading", { name: /Brasil|Estados Unidos|Reino Unido|Alemanha|Franca|China/i }).waitFor({
    timeout: 10000,
  });
  await page.locator(".news-list .news-card").first().waitFor({ timeout: 10000 });
  await page.locator(".action-chip", { hasText: "Central de noticias" }).click();
  await page.locator(".news-list .news-card").first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: "output/playwright/world-watch-news-map.png", fullPage: true });
} finally {
  await browser.close();
}
