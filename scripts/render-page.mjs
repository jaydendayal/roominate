import { chromium } from "@playwright/test";

const raw = process.argv[2];
if (!raw) process.exit(2);
const target = new URL(raw);
if (!["http:", "https:"].includes(target.protocol)) process.exit(2);

const blockedHost = (hostname) => {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "::1" || host.startsWith("fe80:") || host.startsWith("fd") || /^127\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host);
};
if (blockedHost(target.hostname)) process.exit(2);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ userAgent: "RoominateDormResearch/1.0 (+https://roominate.local)" });
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const type = route.request().resourceType();
    if (!["http:", "https:"].includes(requestUrl.protocol) || blockedHost(requestUrl.hostname) || requestUrl.origin !== target.origin || ["image", "media", "font"].includes(type)) {
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.waitForTimeout(750);
  process.stdout.write((await page.content()).slice(0, 1_000_000));
} finally {
  await browser.close();
}
