import type { ReactNode } from "react";
import { RunsPanel } from "./runs-panel";
import { SideMenu } from "./side-menu";

type AppShellProps = {
	children: ReactNode;
	activePath?: string;
};

export function AppShell({ children, activePath = "/" }: AppShellProps) {
	return (
		<div className="dashboard-canvas electrobun-webkit-app-region-drag flex h-full min-h-0 gap-5 px-5 pb-5 pt-10 text-on-surface">
			<SideMenu activePath={activePath} />

			<div className="electrobun-webkit-app-region-no-drag flex min-h-0 min-w-0 flex-1 flex-col gap-5">
				<RunsPanel />
				<main className="min-h-0 min-w-0 flex-1 overflow-y-auto py-2 pr-1">{children}</main>
			</div>
		</div>
	);
}
