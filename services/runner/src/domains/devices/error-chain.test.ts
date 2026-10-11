import { describe, expect, test } from "bun:test";
import { errorChain } from "./error-chain";
import { UsbmuxError } from "./usbmuxd";

describe("errorChain", () => {
	test("walks causes outermost first, with each link's own fields", () => {
		const usbmux = new UsbmuxError("usbmuxd does not list iPhone X", true, ["Y (Network)"]);
		const outer = new Error("Device session ended", { cause: usbmux });
		const chain = errorChain(outer);
		expect(chain.map((link) => link.message)).toEqual([
			"Device session ended",
			"usbmuxd does not list iPhone X",
		]);
		expect(chain[1]?.fields).toMatchObject({ transient: true, listed: ["Y (Network)"] });
		expect(chain[0]?.fields).toBeUndefined();
	});

	test("a non-Error cause ends the chain as text", () => {
		expect(errorChain(new Error("outer", { cause: "socket hang up" })).at(-1)).toEqual({
			name: "string",
			message: "socket hang up",
		});
	});
});
