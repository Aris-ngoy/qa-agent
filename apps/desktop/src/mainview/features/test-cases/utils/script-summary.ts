import { type CaseScriptAction, formatKeyChord } from "@yoqa/runner-client";

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
		const dy = action.y2 - action.y;
		const dx = action.x2 - action.x;
		if (Math.abs(dy) >= Math.abs(dx)) {
			if (dy < -50) return "Swipe up";
			if (dy > 50) return "Swipe down";
		} else {
			if (dx < -50) return "Swipe left";
			if (dx > 50) return "Swipe right";
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
		const check = action.assertion === "visible" ? "visible" : "not visible";
		const elseSide = action.else ? `, else ${stepCount(action.else.length)}` : "";
		return `If “${action.text}” ${check} → ${stepCount(action.then.length)}${elseSide}`;
	}
	return `Wait ${action.ms}ms`;
}
