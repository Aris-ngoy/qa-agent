import { type CaseScriptAction, type CaseScriptBranch, formatKeyChord } from "@yoqa/runner-client";

export function formatScriptSavedAt(ms: number): string {
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(ms));
}

function stepCount(count: number): string {
	return `${count} step${count === 1 ? "" : "s"}`;
}

/**
 * A Branch in words: what it checks (`“X” visible`, `#id visible`) and its sides
 * (`1 step, else 2 steps`). `formatId` words an id target; it reads `#id` by default, as a tap by id does.
 */
export function describeBranch(
	branch: CaseScriptBranch,
	formatId: (id: string) => string = (id) => `#${id}`,
): { check: string; sides: string } {
	const target = branch.id != null ? formatId(branch.id) : `“${branch.text}”`;
	const check = `${target} ${branch.assertion === "visible" ? "visible" : "not visible"}`;
	const elseSide = branch.else ? `, else ${stepCount(branch.else.length)}` : "";
	return { check, sides: `${stepCount(branch.then.length)}${elseSide}` };
}

export function scriptActionSummary(action: CaseScriptAction): string {
	if (action.type === "tap") {
		if (action.label) return `Tap “${action.label}”`;
		if (action.id) return `Tap #${action.id}`;
		return `Tap at (${Math.round(action.x ?? 0)}, ${Math.round(action.y ?? 0)})`;
	}
	if (action.type === "type") {
		return `Type “${action.text}”`;
	}
	if (action.type === "assert") {
		return `Assert ${action.assertion}: “${action.text}”`;
	}
	if (action.type === "alert") {
		return action.alertAction === "dismiss" ? "Dismiss alert" : "Accept alert";
	}
	if (action.type === "swipe") {
		// Named for where the content goes, as the Inspector's Scroll pad is: a finger swipe up
		// scrolls down.
		const dy = action.y2 - action.y;
		const dx = action.x2 - action.x;
		if (Math.abs(dy) >= Math.abs(dx)) {
			if (dy < -50) return "Scroll down";
			if (dy > 50) return "Scroll up";
		} else {
			if (dx < -50) return "Scroll right";
			if (dx > 50) return "Scroll left";
		}
		return `Swipe (${Math.round(action.x)},${Math.round(action.y)})→(${Math.round(action.x2)},${Math.round(action.y2)})`;
	}
	if (action.type === "drag") {
		return `Drag (${Math.round(action.x)},${Math.round(action.y)})→(${Math.round(action.x2)},${Math.round(action.y2)})`;
	}
	if (
		action.type === "activate-app" ||
		action.type === "terminate-app" ||
		action.type === "restart-app"
	) {
		return `${action.type} ${action.appId}`;
	}
	if (action.type === "background-app") {
		return action.seconds != null ? `Background app ${action.seconds}s` : "Background app";
	}
	if (action.type === "open-url") {
		return `Open ${action.url}`;
	}
	if (action.type === "key") {
		return `Press ${formatKeyChord(action.key, action.modifiers)}`;
	}
	if (action.type === "branch") {
		const { check, sides } = describeBranch(action);
		return `If ${check} → ${sides}`;
	}
	return `Wait ${action.ms}ms`;
}
