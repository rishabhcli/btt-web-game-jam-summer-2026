import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const serviceIds = {
  e2e: "browser-history-e2e",
  preview: "production-preview",
  static: "static-bundle",
} as const;
const targetName = process.env["BTT_E2E_TARGET"] ?? "e2e";
if (!Object.hasOwn(serviceIds, targetName)) {
  throw new Error(`E2E_TARGET_INVALID: ${JSON.stringify(targetName)}`);
}
const expectedServiceId = serviceIds[targetName as keyof typeof serviceIds];

test("@integration serves a truthful build state", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-btt-service-id"]).toBe(expectedServiceId);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "The playable rooms are not available yet.",
    }),
  ).toBeVisible();
  await expect(page.getByTestId("readiness-status")).toHaveText(
    "Not yet in production",
  );
});

test("foundation surface has no automatically detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
