import { getRunnerClient } from "@/app/runner-client";
import { type CaseScript, type RunCaseScriptOptions, runCaseScript } from "@yoqa/runner-client";

export function runInspectorCaseScript(script: CaseScript, options: RunCaseScriptOptions = {}) {
	return getRunnerClient().then((client) => runCaseScript(client, script, options));
}
