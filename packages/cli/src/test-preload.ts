/**
 * Loaded before every test (root `bunfig.toml`): keeps the Emitted usage ledger off the
 * developer's real `~/.yoqa`.
 *
 * Since every command writes through the output seam, any test that runs a command against a
 * fake runner answering `/devices/active` is accounted — whether or not it cares about
 * accounting. One file per test process, removed when it exits; a test that reads the ledger
 * sets `YOQA_EMITTED_USAGE_PATH` itself, which wins.
 */

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.YOQA_EMITTED_USAGE_PATH) {
	const path = join(tmpdir(), `yoqa-test-emitted-usage-${process.pid}.jsonl`);
	process.env.YOQA_EMITTED_USAGE_PATH = path;
	process.on("exit", () => rmSync(path, { force: true }));
}
