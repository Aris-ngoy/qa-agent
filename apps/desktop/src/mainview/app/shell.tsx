import { SideMenu } from "@/app/side-menu";
import { SessionBar } from "@/features/devices/session-bar";
import type { ReactNode } from "react";

type AppShellProps = {
	children: ReactNode;
	activePath?: string;
};

export function AppShell({ children, activePath = "/" }: AppShellProps) {
	return (
		<div className="dashboard-canvas electrobun-webkit-app-region-drag flex h-full min-h-0 gap-3 px-3 pb-3 pt-10 text-on-surface">
			<SideMenu activePath={activePath} />

			<div className="electrobun-webkit-app-region-no-drag flex min-h-0 min-w-0 flex-1 flex-col gap-3">
				<SessionBar />
				<main className="app-page min-h-0 min-w-0 flex-1 overflow-y-auto py-2 pr-1">
					{children}
				</main>
			</div>
		</div>
	);
}
