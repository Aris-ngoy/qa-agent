import { getDesktopRpc } from "@/app/desktop-rpc";
import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { Button, Tabs } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { DoctorReport, ServerEntry } from "@yoqa/runner-client";
import { type SVGProps, useEffect, useState } from "react";

export const serversQueryKey = ["servers"] as const;
export const doctorQueryKey = ["doctor"] as const;

function ServerIcon({ className = "size-5", ...props }: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className={`block shrink-0 ${className}`}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<rect height="6" rx="1" width="14" x="5" y="4" />
			<rect height="6" rx="1" width="14" x="5" y="14" />
			<path d="M8 7h.01M8 17h.01" strokeLinecap="round" />
		</svg>
	);
}

function kindBadge(kind: ServerEntry["kind"]): string {
	if (kind === "appium") return "Appium";
	if (kind === "runner") return "Runner";
	return "Session";
}

function ownershipHint(entry: ServerEntry): string {
	if (entry.ownership === "foreign") return "foreign";
	if (entry.ownership === "self") return "self";
	return "managed";
}

function canActViaHttp(entry: ServerEntry, action: "stop" | "restart"): boolean {
	return entry.actions.includes(action);
}

function isRunnerRow(entry: ServerEntry): boolean {
	return entry.kind === "runner";
}

type ServersDoctorPanelProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export function ServersDoctorPanel({ open, onOpenChange }: ServersDoctorPanelProps) {
	const [tab, setTab] = useState<"servers" | "doctor">("servers");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [runnerConfirm, setRunnerConfirm] = useState<"stop" | "restart" | null>(null);
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const serversQuery = useQuery({
		queryKey: serversQueryKey,
		queryFn: async () => (await getRunnerClient()).listServers(),
		enabled: open,
		refetchInterval: open ? 2_000 : false,
	});

	const doctorQuery = useQuery({
		queryKey: doctorQueryKey,
		queryFn: async () => (await getRunnerClient()).getDoctorReport(),
		enabled: open && tab === "doctor",
		refetchInterval: open && tab === "doctor" ? 10_000 : false,
	});

	const servers = serversQuery.data?.servers ?? [];
	const selected = servers.find((item) => item.id === selectedId) ?? null;

	useEffect(() => {
		if (!open) {
			setSelectedId(null);
			setRunnerConfirm(null);
			return;
		}
		if (selectedId && !servers.some((item) => item.id === selectedId)) {
			setSelectedId(null);
		}
	}, [open, selectedId, servers]);

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey: serversQueryKey });
		await queryClient.invalidateQueries({ queryKey: doctorQueryKey });
	};

	const stopAllMutation = useMutation({
		mutationFn: async () => (await getRunnerClient()).stopAllServers(),
		onSuccess: async () => {
			await invalidate();
		},
		onError: (error) => showErrorToast(error, "Stop all failed"),
	});

	const stopMutation = useMutation({
		mutationFn: async (entry: ServerEntry) => {
			if (isRunnerRow(entry)) {
				await getDesktopRpc().request.stopLocalRunner();
				return;
			}
			await (await getRunnerClient()).stopServer(entry.id);
		},
		onSuccess: async () => {
			setRunnerConfirm(null);
			await invalidate();
		},
		onError: (error) => showErrorToast(error, "Stop failed"),
	});

	const restartMutation = useMutation({
		mutationFn: async (entry: ServerEntry) => {
			if (isRunnerRow(entry)) {
				await getDesktopRpc().request.restartLocalRunner();
				return;
			}
			await (await getRunnerClient()).restartServer(entry.id);
		},
		onSuccess: async () => {
			setRunnerConfirm(null);
			await invalidate();
		},
		onError: (error) => showErrorToast(error, "Restart failed"),
	});

	const repairMutation = useMutation({
		mutationFn: async (report: DoctorReport) => {
			const repairs = [
				...new Set(
					report.steps
						.map((step) => step.repair)
						.filter((id): id is NonNullable<typeof id> => Boolean(id)),
				),
			];
			if (repairs.length === 0) {
				throw new Error("No safe repairs available");
			}
			return (await getRunnerClient()).repairDoctor({ repairs });
		},
		onSuccess: async () => {
			await invalidate();
		},
		onError: (error) => showErrorToast(error, "Repair failed"),
	});

	const failingCount =
		doctorQuery.data?.checks.filter((check) => check.status === "fail").length ?? 0;
	const warnCount = doctorQuery.data?.checks.filter((check) => check.status === "warn").length ?? 0;

	return (
		<div className="relative z-50">
			<button
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label="Servers and doctor"
				className={[
					"motion-press flex size-14 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest text-on-surface shadow-soft transition-opacity hover:opacity-100",
					open ? "ring-2 ring-primary/40" : "",
				].join(" ")}
				onClick={() => onOpenChange(!open)}
				title="Servers & doctor"
				type="button"
			>
				<ServerIcon className="size-6" />
			</button>

			{open ? (
				<div className="absolute top-[calc(100%+0.75rem)] right-0 z-[100] w-[22rem] rounded-2xl border border-outline-variant bg-surface-container-lowest p-3 shadow-float">
					<Tabs
						className="w-full"
						onSelectionChange={(key) => setTab(String(key) as "servers" | "doctor")}
						selectedKey={tab}
					>
						<Tabs.ListContainer>
							<Tabs.List
								aria-label="Servers and doctor"
								className="relative w-full gap-1 rounded-xl bg-surface-container p-1"
							>
								<Tabs.Tab
									className="relative z-[1] h-auto min-h-8 flex-1 rounded-lg px-3 py-1.5 text-body-sm font-medium text-on-surface-variant data-[selected=true]:font-semibold data-[selected=true]:!text-on-surface"
									id="servers"
								>
									Servers
									<Tabs.Indicator className="-z-10 rounded-lg bg-surface-container-lowest shadow-card" />
								</Tabs.Tab>
								<Tabs.Tab
									className="relative z-[1] h-auto min-h-8 flex-1 rounded-lg px-3 py-1.5 text-body-sm font-medium text-on-surface-variant data-[selected=true]:font-semibold data-[selected=true]:!text-on-surface"
									id="doctor"
								>
									Doctor
									<Tabs.Indicator className="-z-10 rounded-lg bg-surface-container-lowest shadow-card" />
								</Tabs.Tab>
							</Tabs.List>
						</Tabs.ListContainer>

						<Tabs.Panel className="pt-3" id="servers">
							<div className="mb-2 flex items-center justify-between gap-2">
								<p className="text-helper text-on-surface-variant">
									{serversQuery.isLoading
										? "Loading…"
										: servers.length === 0
											? "No servers running"
											: `${servers.length} running`}
								</p>
								<Button
									isDisabled={stopAllMutation.isPending || servers.length === 0}
									onPress={() => stopAllMutation.mutate()}
									size="sm"
									variant="secondary"
								>
									Stop all
								</Button>
							</div>
							<p className="mb-2 text-helper text-on-surface-variant">
								Stop all ends Appium + the device session. Runner is separate.
							</p>
							<ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
								{servers.map((entry) => {
									const selectedRow = entry.id === selectedId;
									return (
										<li key={entry.id}>
											<button
												className={[
													"flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-colors",
													selectedRow
														? "bg-primary/10 text-on-surface"
														: "hover:bg-surface-container text-on-surface",
												].join(" ")}
												onClick={() => setSelectedId(entry.id)}
												type="button"
											>
												<span className="flex items-center justify-between gap-2">
													<span className="truncate text-body-sm font-medium">{entry.label}</span>
													<span className="shrink-0 text-helper text-on-surface-variant">
														{kindBadge(entry.kind)} · {ownershipHint(entry)}
													</span>
												</span>
												<span className="text-helper text-on-surface-variant">
													{entry.status}
													{entry.port ? ` · :${entry.port}` : ""}
													{entry.pid ? ` · pid ${entry.pid}` : ""}
												</span>
											</button>
										</li>
									);
								})}
							</ul>

							{selected ? (
								<div className="mt-3 flex flex-col gap-2 border-t border-outline-variant pt-3">
									{isRunnerRow(selected) && runnerConfirm ? (
										<div className="flex flex-col gap-2">
											<p className="text-body-sm text-on-surface">
												{runnerConfirm === "stop"
													? "Stop yoqa-runner? The app will lose the local API until you restart it."
													: "Restart yoqa-runner? Brief downtime while the sidecar comes back."}
											</p>
											<div className="flex gap-2">
												<Button onPress={() => setRunnerConfirm(null)} size="sm" variant="tertiary">
													Cancel
												</Button>
												<Button
													isDisabled={stopMutation.isPending || restartMutation.isPending}
													onPress={() => {
														if (runnerConfirm === "stop") stopMutation.mutate(selected);
														else restartMutation.mutate(selected);
													}}
													size="sm"
													variant="primary"
												>
													Confirm
												</Button>
											</div>
										</div>
									) : (
										<div className="flex gap-2">
											<Button
												isDisabled={
													stopMutation.isPending ||
													(!canActViaHttp(selected, "stop") && !isRunnerRow(selected))
												}
												onPress={() => {
													if (isRunnerRow(selected)) setRunnerConfirm("stop");
													else stopMutation.mutate(selected);
												}}
												size="sm"
												variant="secondary"
											>
												Stop
											</Button>
											<Button
												isDisabled={
													restartMutation.isPending ||
													(!canActViaHttp(selected, "restart") && !isRunnerRow(selected))
												}
												onPress={() => {
													if (isRunnerRow(selected)) setRunnerConfirm("restart");
													else restartMutation.mutate(selected);
												}}
												size="sm"
												variant="primary"
											>
												Restart
											</Button>
										</div>
									)}
								</div>
							) : null}
						</Tabs.Panel>

						<Tabs.Panel className="pt-3" id="doctor">
							{doctorQuery.isLoading ? (
								<p className="text-body-sm text-on-surface-variant">Running doctor…</p>
							) : doctorQuery.isError ? (
								<p className="text-body-sm text-error">Could not load doctor report.</p>
							) : doctorQuery.data ? (
								<div className="flex flex-col gap-3">
									<p className="text-body-sm text-on-surface">
										{doctorQuery.data.ok
											? "All required checks passed"
											: `${failingCount} failing · ${warnCount} warning${warnCount === 1 ? "" : "s"}`}
									</p>
									<ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
										{(doctorQuery.data.steps.length > 0
											? doctorQuery.data.steps.slice(0, 5)
											: [
													{
														severity: "info" as const,
														title: "Healthy",
														detail: "No action needed",
													},
												]
										).map((step) => (
											<li
												className="rounded-lg bg-surface-container px-2.5 py-2"
												key={`${step.title}-${step.detail}`}
											>
												<p className="text-body-sm font-medium text-on-surface">{step.title}</p>
												<p className="text-helper text-on-surface-variant">{step.detail}</p>
											</li>
										))}
									</ul>
									<div className="flex flex-wrap gap-2">
										<Button
											isDisabled={
												repairMutation.isPending ||
												!doctorQuery.data.steps.some((step) => step.repair)
											}
											onPress={() => {
												if (doctorQuery.data) repairMutation.mutate(doctorQuery.data);
											}}
											size="sm"
											variant="secondary"
										>
											Repair safe issues
										</Button>
										<Button
											onPress={() => {
												onOpenChange(false);
												void navigate({
													to: "/settings",
													search: { section: "diagnostics" },
												});
											}}
											size="sm"
											variant="primary"
										>
											Open Diagnostics
										</Button>
									</div>
								</div>
							) : null}
						</Tabs.Panel>
					</Tabs>
				</div>
			) : null}
		</div>
	);
}
