#!/usr/bin/env bun
import { createRunnerClient } from "@qa-agent/runner-client";
import { Command } from "commander";
import { runnerBaseUrl } from "../../settings";

const program = new Command();

program
	.name("qa-agent")
	.description("Local qa-agent CLI (talks to the Bun runner over HTTP)")
	.version("0.1.0");

program
	.command("health")
	.description("Check that the local runner is reachable")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.action(async (options: { baseUrl: string }) => {
		const client = createRunnerClient({ baseUrl: options.baseUrl });
		try {
			const health = await client.health();
			console.log(JSON.stringify(health, null, 2));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`qa-agent health failed: ${message}`);
			console.error("Is the runner up? Try: bun run runner");
			process.exitCode = 1;
		}
	});

await program.parseAsync(process.argv);
