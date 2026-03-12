import { chromium } from "playwright";

const target = process.env.WORLD_WATCH_E2E_URL || "http://127.0.0.1:5173";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

try {
  await page.goto(target, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByRole("heading", { name: /World Watch/i }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /Brasil/i }).click();
  await page.getByRole("heading", { name: /Brasil/i }).waitFor({ timeout: 10000 });
  await page.getByText(/Noticias recentes/i).waitFor({ timeout: 10000 });
  await page.screenshot({ path: "output/playwright/world-watch-home.png", fullPage: true });
} finally {
  await browser.close();
}
