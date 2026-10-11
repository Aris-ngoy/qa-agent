import { devError } from "@/app/dev-log";
import { toast } from "@heroui/react";
import { RunnerRequestError } from "@yoqa/runner-client";

const TITLE_MAX_LENGTH = 72;

type SummarizedError = {
	title: string;
	description?: string;
};

function truncateTitle(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length <= TITLE_MAX_LENGTH) {
		return trimmed;
	}
	return `${trimmed.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

/** Map known long runner errors to short toast copy. */
export function summarizeError(message: string): SummarizedError {
	if (message.includes("No enabled AI provider configured")) {
		return {
			title: "No AI provider configured",
			description: "Add a vision-capable provider in Settings.",
		};
	}
	if (message.includes("does not support vision runs")) {
		return {
			title: "Provider doesn't support vision",
			description: "Configure a vision-capable provider in Settings.",
		};
	}
	if (message.includes("is not authenticated for vision")) {
		if (
			message.includes('"opencode"') ||
			message.includes("opencode providers login") ||
			message.includes("OPENCODE_API_KEY")
		) {
			return {
				title: "Provider not authenticated",
				description: "Paste a Zen API key from opencode.ai in Settings (OPENCODE_API_KEY).",
			};
		}
		return {
			title: "Provider not authenticated",
			description: "Fix auth or API key in Settings.",
		};
	}

	const firstSentence = message.split(/(?<=[.!?])\s+/)[0]?.trim() || message.trim();
	const title = truncateTitle(firstSentence);
	if (message.trim().length > firstSentence.length + 20) {
		return { title, description: truncateTitle(message.trim().slice(firstSentence.length).trim()) };
	}
	return { title };
}

/**
 * In dev builds, print the full error that a toast shortens: message, stack, cause and,
 * for a failed runner request, its HTTP status, body (a Dead Session's `chain`) and which
 * runner process answered.
 */
export function logDevError(context: string, error: unknown): void {
	if (error instanceof RunnerRequestError) {
		devError(`${context}: ${error.message}`, {
			status: error.status,
			answeredBy: error.answeredBy,
			body: error.body,
			stack: error.stack,
		});
		return;
	}
	devError(context, error);
}

export function showErrorToast(error: unknown, fallback: string): void {
	logDevError(fallback, error);
	const message = error instanceof Error ? error.message : fallback;
	const { title, description } = summarizeError(message || fallback);
	toast.danger(title, description ? { description } : undefined);
}
