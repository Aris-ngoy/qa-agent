import { useApps } from "@/features/apps/context";
import { useActiveDeviceSession } from "@/features/devices/use-active-device-session";
import { caseQueryKey } from "@/features/test-cases/data";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouterState } from "@tanstack/react-router";

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
	const { caseId } = useParams({ strict: false }) as { caseId?: string };
	const { selectedApp } = useApps();
	const { activeSession } = useActiveDeviceSession();
	const isCaseDetail = pathname.startsWith("/test-cases/") && Boolean(caseId);
	const caseQuery = useQuery<{ name?: string }>({
		queryKey: caseId ? caseQueryKey(caseId) : ["catalog", "case", "none"],
		enabled: false,
	});

	let caption = selectedApp?.name ?? "QA Agent";
	let title = PAGE_TITLES[pathname] ?? "QA Agent";
	let status: "live" | "idle" | null = null;

	if (pathname.startsWith("/inspector")) {
		caption = "Inspector";
		status = activeSession ? "live" : "idle";
		title = activeSession ? "Live session" : "No device connected";
	} else if (isCaseDetail) {
		caption = "Test case";
		title = caseQuery.data?.name || "Test case";
	} else if (pathname.startsWith("/runs/")) {
		caption = "Run";
		title = "Run details";
	}

	return (
		<div className="mr-auto flex min-w-0 flex-col">
			<span className="truncate text-helper text-on-surface-variant">{caption}</span>
			<h1 className="m-0 flex min-w-0 items-center gap-2 text-[1rem] font-bold leading-6 text-on-surface">
				{status ? (
					<span
						aria-hidden="true"
						className={[
							"size-2 shrink-0 rounded-full",
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
