import type { CaseFlowStep, CaseRunStatus, CaseScript, CatalogCase } from "@yoqa/runner-client";

export type CaseStatus = CaseRunStatus;

export type TestFlow = {
	id: string;
	instructions: string;
	expectedResult: string;
	flowId?: string | null;
};

export type TestCase = {
	id: string;
	appId: string;
	number: number;
	name: string;
	created: string;
	lastRun: string;
	status: CaseStatus | null;
	tags: string[];
	flows: TestFlow[];
	capabilities: Array<{ id: string; key: string; value: string }>;
	hasScript: boolean;
	scriptSavedAt: number | null;
	script: CaseScript | null;
	createdAt: number;
	updatedAt: number;
	lastRunAt: number | null;
};

function formatAbsoluteDate(ms: number): string {
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(ms));
}

function formatRelativeTime(ms: number, now = Date.now()): string {
	const deltaSec = Math.round((ms - now) / 1000);
	const absSec = Math.abs(deltaSec);
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
	if (absSec < 60) return rtf.format(deltaSec, "second");
	const deltaMin = Math.round(deltaSec / 60);
	if (Math.abs(deltaMin) < 60) return rtf.format(deltaMin, "minute");
	const deltaHour = Math.round(deltaMin / 60);
	if (Math.abs(deltaHour) < 24) return rtf.format(deltaHour, "hour");
	const deltaDay = Math.round(deltaHour / 24);
	if (Math.abs(deltaDay) < 30) return rtf.format(deltaDay, "day");
	return formatAbsoluteDate(ms);
}

export function mapCatalogCase(row: CatalogCase, now = Date.now()): TestCase {
	return {
		id: row.id,
		appId: row.appId,
		number: row.number,
		name: row.name,
		created: formatAbsoluteDate(row.createdAt),
		lastRun: row.lastRunAt == null ? "Never" : formatRelativeTime(row.lastRunAt, now),
		status: row.lastRunStatus,
		tags: [...row.tags],
		flows: row.flows.map((flow: CaseFlowStep) => ({
			id: flow.id,
			instructions: flow.instructions,
			expectedResult: flow.expectedResult,
			flowId: flow.flowId ?? null,
		})),
		capabilities: row.capabilities.map((cap) => ({ ...cap })),
		hasScript: row.hasScript,
		scriptSavedAt: row.scriptSavedAt,
		script: row.script
			? { ...row.script, actions: row.script.actions.map((a) => ({ ...a })) }
			: null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		lastRunAt: row.lastRunAt,
	};
}

export function casesQueryKey(appId: string) {
	return ["catalog", "cases", appId] as const;
}

export function caseQueryKey(caseId: string) {
	return ["catalog", "case", caseId] as const;
}
