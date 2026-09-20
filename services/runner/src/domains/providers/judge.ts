import { resolveJudgeProviderAuth } from "./application";
import { getDriver } from "./drivers";
import type { InstructionJudgeInput, InstructionJudgeVerdict } from "./drivers/types";

export type CaseJudgeInput = Omit<InstructionJudgeInput, "auth">;

/**
 * Confirm a vision verify/done/fail against a judge-capable provider when one is enabled.
 * Returns null when no judge is configured or the call fails (fail-open).
 */
export async function confirmInstruction(
	input: CaseJudgeInput,
): Promise<InstructionJudgeVerdict | null> {
	const auth = await resolveJudgeProviderAuth();
	if (!auth) return null;
	const port = getDriver(auth.kind).judge;
	if (!port) return null;
	try {
		return await port.confirmInstruction({ ...input, auth });
	} catch (error) {
		console.error(
			"Judge provider failed; keeping the vision decision",
			error instanceof Error ? error.message : error,
		);
		return null;
	}
}
