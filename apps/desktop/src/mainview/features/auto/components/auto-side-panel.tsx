import { AutoDeviceTab } from "@/features/auto/components/auto-device-tab";
import { Tabs } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import type { ReactNode } from "react";

type SideTab = "device" | "test" | "history";

const TABS: { id: SideTab; label: string }[] = [
	{ id: "device", label: "Device" },
	{ id: "test", label: "Test" },
	{ id: "history", label: "History" },
];

/** The right of Auto: the live device, and (in later tickets) the Case draft and the case's History. */
export function AutoSidePanel() {
	const tab$ = useObservable<SideTab>("device");
	const tab = useValue(tab$);

	return (
		<section
			aria-label="Auto panels"
			className="flex h-full min-h-0 flex-col gap-3 rounded-[var(--radius)] border border-outline-variant bg-surface-bright p-3"
		>
			<Tabs
				className="flex min-h-0 w-full flex-1 flex-col gap-3"
				onSelectionChange={(key) => tab$.set(String(key) as SideTab)}
				selectedKey={tab}
			>
				<Tabs.ListContainer>
					<Tabs.List
						aria-label="Auto panels"
						className="relative w-full gap-1 rounded-xl bg-surface-container p-1"
					>
						{TABS.map((item) => (
							<Tabs.Tab
								className="relative z-[1] h-auto min-h-8 flex-1 rounded-lg px-3 py-1 text-body-sm font-medium text-on-surface-variant transition-[color,opacity] duration-[var(--motion-fast)] data-[selected=true]:font-semibold data-[selected=true]:!text-on-surface"
								id={item.id}
								key={item.id}
							>
								{item.label}
								<Tabs.Indicator className="-z-10 rounded-lg bg-surface-container-lowest shadow-card" />
							</Tabs.Tab>
						))}
					</Tabs.List>
				</Tabs.ListContainer>

				{/* Only the shown tab mounts: leaving Device stops its frame feed. */}
				<Tabs.Panel className="min-h-0 flex-1 overflow-y-auto pt-0 outline-none" id="device">
					{tab === "device" ? <AutoDeviceTab /> : null}
				</Tabs.Panel>
				<Tabs.Panel className="min-h-0 flex-1 pt-0 outline-none" id="test">
					{tab === "test" ? (
						<PanelEmpty title="No Case draft">
							When the chat agent can write steps (Run mode), its Case draft shows here as changes
							to the saved Test Case.
						</PanelEmpty>
					) : null}
				</Tabs.Panel>
				<Tabs.Panel className="min-h-0 flex-1 pt-0 outline-none" id="history">
					{tab === "history" ? (
						<PanelEmpty title="History is on its way">
							The chat's Test Case, its pass rate and its recent Runs will show here.
						</PanelEmpty>
					) : null}
				</Tabs.Panel>
			</Tabs>
		</section>
	);
}

function PanelEmpty({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="flex h-full min-h-56 flex-col items-center justify-center gap-2 rounded-xl bg-surface-container px-6 text-center">
			<p className="m-0 text-body-sm font-medium text-on-surface">{title}</p>
			<p className="m-0 max-w-xs text-helper text-on-surface-variant">{children}</p>
		</div>
	);
}
