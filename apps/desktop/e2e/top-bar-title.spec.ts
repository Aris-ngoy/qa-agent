import { type ConsoleMessage, type Page, expect, test } from "@playwright/test";
import { SEED } from "./harness";

/** Console errors and warnings, collected for the whole test. */
function collectConsoleProblems(page: Page) {
	const problems: string[] = [];
	page.on("console", (message: ConsoleMessage) => {
		if (message.type() === "error" || message.type() === "warning") problems.push(message.text());
	});
	return problems;
}

function topBarTitle(page: Page) {
	const heading = page.getByRole("heading", { level: 1 });
	return { heading, caption: heading.locator("xpath=preceding-sibling::span[1]") };
}

test("the top bar names the open test case and Run from the cache", async ({ page }) => {
	const problems = collectConsoleProblems(page);
	const { heading, caption } = topBarTitle(page);

	await page.goto("/");
	await page.getByRole("link", { name: "Test Cases" }).click();
	await page.getByText(SEED.caseName).click();
	await expect(page).toHaveURL(/\/test-cases\/case_/);
	await expect(caption).toHaveText("Test case");
	await expect(heading).toHaveText(SEED.caseName);

	await page.getByRole("link", { name: "Runs" }).click();
	await page.getByText(SEED.runDeviceId).first().click();
	await expect(page).toHaveURL(new RegExp(`/runs/${SEED.runId}$`));
	await expect(heading).toHaveText("Run details");
	await expect(caption).toHaveText(`Runs / ${SEED.runDeviceId} (Web)`);

	expect(problems.filter((text) => text.includes("No queryFn"))).toEqual([]);
});

test("the top bar title never fetches the case or Run itself", async ({ page }) => {
	const titleOnlyRequests: string[] = [];
	page.on("request", (request) => {
		const { pathname } = new URL(request.url());
		if (/^\/(cases|runs)\/[^/]+$/.test(pathname)) titleOnlyRequests.push(pathname);
	});

	// Pages without a case or Run of their own: anything fetched by id would be the title's.
	await page.goto("/test-cases");
	await expect(page.getByText(SEED.caseName)).toBeVisible();
	await page.getByRole("link", { name: "Runs" }).click();
	await expect(page.getByText(SEED.runDeviceId).first()).toBeVisible();

	expect(titleOnlyRequests).toEqual([]);
});
