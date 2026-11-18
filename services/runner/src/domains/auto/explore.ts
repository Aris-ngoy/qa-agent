import type { ActionRequest, ScreenSource } from "@yoqa/runner-client";
import { getActiveSession, isActiveSessionHeldByRun } from "../devices/active-session";
import {
	ActionNotFoundError,
	ActionValidationError,
	getScreen,
	performAction,
} from "../devices/interaction";
import { ActionUnsupportedError } from "../devices/lane";
import type { DeviceSession } from "../devices/session";
import { formatScreenSnapshot } from "../runs/agent";
import type { ChatToolOutput } from "./chat-agent";

/**
 * Explore's own use of the connected device: the chat agent reads the Screen as text and acts
 * on it directly. Nothing here is recorded: not in a Run, not in a Case draft.
 */

/**
 * The Device Session the chat agent may explore now, or why it may not, as text: not while a
 * Run holds it (taken over too: the user has it then).
 */
function sessionToExplore(): DeviceSession | string {
	const active = getActiveSession();
	if (!active) {
		return "No device is connected. Ask the user to connect one from the top bar.";
	}
	if (isActiveSessionHeldByRun()) {
		return "A Run is using the device. Wait for it to end, then try again.";
	}
	return active.session;
}

function refusal(text: string): ChatToolOutput {
	return { text, isError: true };
}

function sourceLine(source: ScreenSource | undefined): string | null {
	if (!source) return null;
	if (source.kind === "system") return "Read from the system (SpringBoard), not an app.";
	return `Read from ${source.bundleId ?? "an unnamed app"} (${source.kind === "target" ? "target app" : "foreground app"}).`;
}

/**
 * The connected device's Screen as text: each element's position and size on the 0–1000 grid,
 * its id and its label, top to bottom; refused when it cannot be read.
 */
export async function readChatScreen(): Promise<ChatToolOutput> {
	const session = sessionToExplore();
	if (typeof session === "string") return refusal(session);
	const screen = await getScreen(session, { full: false });
	const lines = [
		sourceLine(screen.source),
		`Screen (x,y of each element's top left, width x height, on a 0–1000 grid):`,
		formatScreenSnapshot(screen.elements),
	].filter((line) => line !== null);
	return { text: lines.join("\n"), isError: false };
}

/** What an Action does, as the chat agent reads it back. */
function describeAction(request: ActionRequest, resolved: { x?: number; y?: number } | undefined) {
	const target = request.id
		? ` on id ${request.id}`
		: request.label
			? ` on "${request.label}"`
			: request.description
				? ` on "${request.description}"`
				: "";
	const at =
		resolved?.x != null && resolved.y != null
			? ` at ${Math.round(resolved.x)},${Math.round(resolved.y)}`
			: "";
	return `Done: ${request.kind}${target}${at}. Read the Screen to see what it did.`;
}

/** Perform one Action on the connected device; what it did, or why it could not, as text. */
export async function performChatAction(request: ActionRequest): Promise<ChatToolOutput> {
	const session = sessionToExplore();
	if (typeof session === "string") return refusal(session);
	try {
		const result = await performAction(session, request);
		return { text: describeAction(request, result.resolved), isError: false };
	} catch (error) {
		if (
			error instanceof ActionValidationError ||
			error instanceof ActionNotFoundError ||
			error instanceof ActionUnsupportedError
		) {
			return refusal(error.message);
		}
		throw error;
	}
}
