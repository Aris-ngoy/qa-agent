import { describe, expect, test } from "bun:test";
import {
	type AlertBrowser,
	androidAlertAttempts,
	iosAlertAttempts,
	resolveNativeAlert,
} from "./android-alerts";

describe("alert attempt order", () => {
	test("Android accept tries mobile: acceptAlert then Allow ids then exact text", () => {
		const methods = androidAlertAttempts("accept").map((attempt) => attempt.method);
		expect(methods[0]).toBe("mobile-acceptAlert");
		expect(methods).toContain("resource-id");
		expect(methods).toContain("text");
		expect(methods.at(-1)).toBe("text");
		const texts = androidAlertAttempts("accept")
			.filter((attempt) => attempt.method === "text")
			.map((attempt) => (attempt.method === "text" ? attempt.text : ""));
		expect(texts).toContain("Allow");
		expect(texts).not.toContain("Don't allow");
	});

	test("iOS tries W3C then mobile: alert", () => {
		expect(iosAlertAttempts("accept").map((attempt) => attempt.method)).toEqual([
			"w3c-acceptAlert",
			"mobile-alert",
		]);
	});
});

describe("resolveNativeAlert", () => {
	test("clicks the permission allow resource-id when mobile commands fail", async () => {
		const clicks: string[] = [];
		const browser: AlertBrowser = {
			capabilities: { platformName: "Android" },
			execute: async () => {
				throw new Error("no such alert");
			},
			acceptAlert: async () => {
				throw new Error("no such alert");
			},
			dismissAlert: async () => {
				throw new Error("no such alert");
			},
			$: (selector) => ({
				isExisting: async () =>
					selector.includes("permission_allow_button") && selector.includes("permissioncontroller"),
				click: async () => {
					clicks.push(selector);
				},
			}),
		};
		const used = await resolveNativeAlert(browser, "accept");
		expect(used).toEqual({
			method: "resource-id",
			id: "com.android.permissioncontroller:id/permission_allow_button",
		});
		expect(clicks.length).toBe(1);
	});

	test("iOS succeeds via W3C acceptAlert", async () => {
		let accepted = 0;
		const browser: AlertBrowser = {
			capabilities: { platformName: "iOS" },
			execute: async () => {
				throw new Error("unused");
			},
			acceptAlert: async () => {
				accepted += 1;
			},
			dismissAlert: async () => {
				throw new Error("unused");
			},
			$: () => ({
				isExisting: async () => false,
				click: async () => {},
			}),
		};
		expect(await resolveNativeAlert(browser, "accept")).toEqual({ method: "w3c-acceptAlert" });
		expect(accepted).toBe(1);
	});

	test("throws when nothing can be clicked", async () => {
		const browser: AlertBrowser = {
			capabilities: { platformName: "Android" },
			execute: async () => {
				throw new Error("nope");
			},
			acceptAlert: async () => {
				throw new Error("nope");
			},
			dismissAlert: async () => {
				throw new Error("nope");
			},
			$: () => ({
				isExisting: async () => false,
				click: async () => {},
			}),
		};
		await expect(resolveNativeAlert(browser, "accept")).rejects.toThrow(/Could not accept/);
	});
});
