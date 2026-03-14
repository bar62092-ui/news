import { chromium } from "playwright";

const target = process.env.WORLD_WATCH_E2E_URL || "http://127.0.0.1:5173";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

try {
  await page.goto(target, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByRole("heading", { name: /World Watch/i }).waitFor({ timeout: 10000 });
  await page.getByRole("heading", { name: /Risco por pais/i }).waitFor({ timeout: 10000 });
  await page.getByRole("heading", { name: /DEFCON e alertas/i }).waitFor({ timeout: 10000 });
  await page.getByRole("heading", { name: /Epidemias e doencas/i }).waitFor({ timeout: 10000 });
  await page.getByRole("heading", { name: /Ativos reagindo a noticias/i }).waitFor({ timeout: 10000 });
  await page.locator(".signal-card").first().click();
  await page.locator(".timeline-card, .context-summary").first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: "output/playwright/world-watch-news-desk.png", fullPage: true });
} finally {
  await browser.close();
}
