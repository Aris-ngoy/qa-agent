import { useApps } from "@/features/apps/hooks/use-apps";
import { useActiveDeviceSession } from "@/features/devices/hooks/usequery/use-active-device-session";
import { devicesQueryKey } from "@/features/devices/hooks/usequery/use-devices";
import { runQueryKey } from "@/features/runs/hooks/usequery/use-run";
import { formatDeviceShortLabel } from "@/features/runs/utils/labels";
import { caseQueryKey } from "@/features/test-cases/hooks/usequery/use-cases";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import type { Device, Run } from "@yoqa/runner-client";
import type { ReactNode } from "react";

const PAGE_TITLES: Record<string, string> = {
	"/": "Welcome",
	"/test-cases": "Test Cases",
	"/runs": "Runs",
	"/configuration": "Configuration",
	"/settings": "Settings",
};

/**
 * The page title at the left of the top bar: a small caption over the bold title. The
 * Inspector shows the session state, and a test case its name (read from the detail
 * page's cache, never fetched here).
 */
export function SessionBarTitle() {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const { caseId, runId } = useParams({ strict: false }) as { caseId?: string; runId?: string };
	const { selectedApp } = useApps();
	const { activeSession } = useActiveDeviceSession();
	const isCaseDetail = pathname.startsWith("/test-cases/") && Boolean(caseId);
	const isRunDetail = pathname.startsWith("/runs/") && Boolean(runId);
	const caseQuery = useQuery<{ name?: string }>({
		queryKey: caseId ? caseQueryKey(caseId) : ["catalog", "case", "none"],
		enabled: false,
	});
	const runQuery = useQuery<Run>({
		queryKey: runId ? runQueryKey(runId) : ["runs", "none"],
		enabled: false,
	});
	const run = isRunDetail ? runQuery.data : undefined;
	const devicesQuery = useQuery<Device[]>({
		queryKey: run ? devicesQueryKey(run.platform) : ["devices", "pending"],
		enabled: false,
	});

	let caption: ReactNode = selectedApp?.name ?? "QA Agent";
	let title = PAGE_TITLES[pathname] ?? "QA Agent";
	let status: "live" | "idle" | null = null;

	if (pathname.startsWith("/inspector")) {
		caption = "Inspector";
		status = activeSession ? "live" : "idle";
		title = activeSession ? "Live session" : "No device connected";
	} else if (isCaseDetail) {
		caption = "Test case";
		title = caseQuery.data?.name || "Test case";
	} else if (isRunDetail) {
		const device = (devicesQuery.data ?? []).find((row) => row.id === run?.deviceId);
		const deviceLabel = run
			? formatDeviceShortLabel(device, { deviceId: run.deviceId, platform: run.platform })
			: null;
		caption = (
			<>
				<Link className="hover:text-on-surface" to="/runs">
					Runs
				</Link>
				{deviceLabel ? ` / ${deviceLabel}` : null}
			</>
		);
		title = "Run details";
	}

	return (
		<div className="mr-auto flex min-w-0 flex-col gap-px">
			<span className="truncate text-[11px] leading-tight text-outline">{caption}</span>
			<h1 className="m-0 flex min-w-0 items-center gap-2 text-[15px] font-semibold leading-tight tracking-tight text-on-surface">
				{status ? (
					<span
						aria-hidden="true"
						className={[
							"size-1.5 shrink-0 rounded-full",
							status === "live" ? "bg-secondary" : "bg-outline",
						].join(" ")}
					/>
				) : null}
				<span className={["truncate", status === "live" ? "text-secondary" : ""].join(" ")}>
					{title}
				</span>
			</h1>
		</div>
	);
}
