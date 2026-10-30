import { describe, expect, test } from "bun:test";
import { REMOTE_DEBUGGING_SETTING_URL } from "../../../shared/everyday-browser";
import { openRemoteDebuggingSetting } from "./index";

function recorder(code = 0) {
	const commands: string[][] = [];
	return {
		commands,
		run: async (command: string[]) => {
			commands.push(command);
			return code;
		},
	};
}

describe("openRemoteDebuggingSetting", () => {
	test("opens chrome://inspect/#remote-debugging in that browser's app", async () => {
		const host = recorder();
		const result = await openRemoteDebuggingSetting("web-dia-everyday", {
			platform: "darwin",
			run: host.run,
		});
		expect(result).toEqual({ ok: true });
		expect(host.commands).toEqual([["open", "-a", "Dia", REMOTE_DEBUGGING_SETTING_URL]]);
		expect(REMOTE_DEBUGGING_SETTING_URL).toBe("chrome://inspect/#remote-debugging");
	});

	test("names each Everyday browser's app as macOS knows it", async () => {
		const host = recorder();
		for (const id of [
			"web-chrome-everyday",
			"web-edge-everyday",
			"web-brave-everyday",
			"web-chromium-everyday",
		]) {
			await openRemoteDebuggingSetting(id, { platform: "darwin", run: host.run });
		}
		expect(host.commands.map((command) => command[2])).toEqual([
			"Google Chrome",
			"Microsoft Edge",
			"Brave Browser",
			"Chromium",
		]);
	});

	test("opens nothing for an id that is not an Everyday browser", async () => {
		const host = recorder();
		const result = await openRemoteDebuggingSetting("web-chrome", {
			platform: "darwin",
			run: host.run,
		});
		expect(result).toEqual({ ok: false, error: "web-chrome is not an Everyday browser" });
		expect(host.commands).toEqual([]);
	});

	test("says why when open fails, and is macOS only", async () => {
		expect(
			await openRemoteDebuggingSetting("web-dia-everyday", {
				platform: "darwin",
				run: recorder(1).run,
			}),
		).toEqual({ ok: false, error: "Could not open Dia (open exited with code 1)" });
		const host = recorder();
		expect(
			await openRemoteDebuggingSetting("web-dia-everyday", { platform: "win32", run: host.run }),
		).toEqual({
			ok: false,
			error: "Open chrome://inspect/#remote-debugging in Dia yourself: this works on macOS only",
		});
		expect(host.commands).toEqual([]);
	});
});
