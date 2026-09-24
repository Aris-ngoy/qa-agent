import { describe, expect, it } from "bun:test";
import { runCommand } from "./probe";

describe("runCommand", () => {
	it("captures stdout and the exit code", async () => {
		const result = await runCommand(["echo", "hi"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("hi");
		expect(result.timedOut).toBeUndefined();
	});

	it("kills a hung command at the deadline instead of waiting for pipe EOF", async () => {
		const started = Date.now();
		const result = await runCommand(["/bin/sleep", "30"], { timeoutMs: 200 });
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(result.timedOut).toBe(true);
		expect(result.exitCode).toBe(124);
		expect(result.stderr).toContain("timed out after 200ms");
	});

	it("returns the partial output collected before the kill", async () => {
		const result = await runCommand(["sh", "-c", "printf hello; /bin/sleep 30"], {
			timeoutMs: 300,
		});
		expect(result.timedOut).toBe(true);
		expect(result.stdout).toContain("hello");
	});
});
