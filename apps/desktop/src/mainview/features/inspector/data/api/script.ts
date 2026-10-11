import { getRunnerClient } from "@/app/runner-client";
import { type RunYoqaShellScriptOptions, runYoqaShellScript } from "@yoqa/runner-client";

export function runInspectorShellScript(text: string, options: RunYoqaShellScriptOptions = {}) {
	return getRunnerClient().then((client) => runYoqaShellScript(client, text, options));
}
