import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { devicesQueryKey } from "@/features/runs/utils/labels";
import { TierBadge } from "@/features/settings/components/brand-marks";
import { Button, ListBox, Select, Spinner } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	IosSigningCheckResponse,
	IosSigningStatus,
	IosSigningTeam,
} from "@yoqa/runner-client";
import { useState } from "react";

const IOS_SIGNING_QUERY_KEY = ["ios-signing"] as const;
/** The Select key for "no saved team": the keychain's newest certificate signs. */
const AUTO = "auto";

function day(iso: string): string {
	return iso.slice(0, 10);
}

function teamFacts(team: IosSigningTeam): string {
	return [
		team.inXcode ? "In Xcode" : "Not in Xcode",
		team.certificate
			? `certificate until ${day(team.certificate.expiresAt)}`
			: "no certificate yet",
	].join(" · ");
}

function TeamLabel({ team }: { team: IosSigningTeam }) {
	return (
		<span className="flex min-w-0 items-center gap-2.5">
			{team.personal !== null ? <TierBadge tier={team.personal ? "Personal" : "Paid"} /> : null}
			<span className="truncate text-body-md text-on-surface">
				<span className="font-medium">{team.id}</span>{" "}
				<span className="text-on-surface-variant">{team.name ?? "Unknown team"}</span>
			</span>
		</span>
	);
}

function autoLabel(status: IosSigningStatus): string {
	const newest = status.source === "keychain" ? status.team : null;
	return newest ? `Automatic — newest certificate (${newest})` : "Automatic — newest certificate";
}

/**
 * The Apple team that signs YoqaRunner for a cabled iPhone. The runner stores it, so the CLI
 * (`yoqa signing`) sees the same choice; "Check" signs for a phone now and says what to fix.
 */
export function IosSigningCard({ enabled }: { enabled: boolean }) {
	const queryClient = useQueryClient();
	const [checks, setChecks] = useState<Record<string, IosSigningCheckResponse>>({});

	const signingQuery = useQuery({
		queryKey: IOS_SIGNING_QUERY_KEY,
		enabled,
		queryFn: async () => (await getRunnerClient()).getIosSigning(),
		staleTime: 30_000,
	});

	const phonesQuery = useQuery({
		queryKey: devicesQueryKey("ios"),
		enabled,
		queryFn: async () => (await getRunnerClient()).listDevices("ios", { includeUnavailable: true }),
		select: (response) =>
			response.devices.filter(
				(device) => device.kind === "physical" && device.unavailableReason === undefined,
			),
	});

	const teamMutation = useMutation({
		mutationFn: async (team: string | null) => (await getRunnerClient()).setIosSigningTeam(team),
		onSuccess: (status) => {
			queryClient.setQueryData(IOS_SIGNING_QUERY_KEY, status);
			setChecks({});
		},
		onError: (error) => showErrorToast(error, "Could not save the signing team"),
	});

	const checkMutation = useMutation({
		mutationFn: async (deviceId: string) => (await getRunnerClient()).checkIosSigning({ deviceId }),
		onSuccess: (check) => {
			setChecks((current) => ({ ...current, [check.deviceId]: check }));
			void queryClient.invalidateQueries({ queryKey: IOS_SIGNING_QUERY_KEY });
		},
		onError: (error) => showErrorToast(error, "Could not check signing"),
	});

	const status = signingQuery.data;
	const selectedKey = status?.saved ?? AUTO;
	const selectedTeam = status?.teams.find((team) => team.id === status.saved) ?? null;
	const phones = phonesQuery.data ?? [];
	const checkingId = checkMutation.isPending ? checkMutation.variables : null;

	return (
		<>
			<h3 className="text-subheading font-semibold text-on-surface">Signing team</h3>
			<p className="mt-1 mb-3 text-body-md text-on-surface-variant">
				Apple team that signs YoqaRunner on a cabled iPhone. Shared with the CLI (
				<code className="font-mono text-body-sm">yoqa signing</code>).
			</p>

			{signingQuery.isLoading ? (
				<p className="text-body-md text-on-surface-variant">Reading signing teams…</p>
			) : signingQuery.isError || !status ? (
				<p className="text-body-md text-error">
					Could not read signing teams from the runner. Check Diagnostics, then open Settings again.
				</p>
			) : (
				<>
					<Select
						aria-label="Signing team"
						isDisabled={teamMutation.isPending}
						selectedKey={selectedKey}
						onSelectionChange={(key) => {
							if (key == null || String(key) === selectedKey) return;
							teamMutation.mutate(String(key) === AUTO ? null : String(key));
						}}
					>
						<Select.Trigger className="h-12 w-full items-center gap-3 rounded-xl border border-outline-variant bg-surface-container px-3.5 shadow-none">
							<Select.Value>
								{() =>
									selectedTeam ? (
										<TeamLabel team={selectedTeam} />
									) : (
										<span className="truncate text-body-md text-on-surface">
											{autoLabel(status)}
										</span>
									)
								}
							</Select.Value>
							{teamMutation.isPending ? <Spinner size="sm" /> : null}
							<Select.Indicator className="text-on-surface-variant" />
						</Select.Trigger>
						<Select.Popover className="max-h-80">
							<ListBox>
								<ListBox.Item id={AUTO} key={AUTO} textValue={autoLabel(status)}>
									<span className="truncate">{autoLabel(status)}</span>
									<ListBox.ItemIndicator />
								</ListBox.Item>
								{status.teams.map((team) => (
									<ListBox.Item
										id={team.id}
										key={team.id}
										textValue={`${team.id} ${team.name ?? ""}`}
									>
										<span className="flex min-w-0 flex-col gap-0.5">
											<TeamLabel team={team} />
											<span className="text-body-sm text-on-surface-variant">
												{teamFacts(team)}
											</span>
										</span>
										<ListBox.ItemIndicator />
									</ListBox.Item>
								))}
							</ListBox>
						</Select.Popover>
					</Select>

					{status.teams.length === 0 ? (
						<p className="mt-2 text-body-sm text-on-surface-variant">
							No teams on this Mac. Sign in to Xcode › Settings › Accounts with your Apple ID (a
							free account works).
						</p>
					) : null}

					{status.envOverride ? (
						<p className="mt-2 rounded-lg bg-warning-container px-3 py-2 text-body-sm text-on-warning-container">
							<code className="font-mono">YOQA_IOS_TEAM_ID={status.envOverride}</code> is set in the
							runner's environment and wins over this choice.
						</p>
					) : null}

					{status.team && status.bundleId ? (
						<p className="mt-2 text-body-sm text-on-surface-variant">
							Signing with <span className="font-medium text-on-surface">{status.team}</span> as App
							ID <code className="font-mono">{status.bundleId}</code>.
						</p>
					) : null}

					<div className="mt-4 flex flex-col gap-2">
						<p className="text-body-md font-medium text-on-surface">Check a cabled iPhone</p>
						{phones.length === 0 ? (
							<p className="text-body-sm text-on-surface-variant">
								{phonesQuery.isLoading
									? "Looking for iPhones…"
									: "No cabled iPhone. Connect one with a cable and unlock it."}
							</p>
						) : (
							phones.map((phone) => {
								const check = checks[phone.id];
								const checking = checkingId === phone.id;
								return (
									<div
										className="rounded-xl border border-outline-variant bg-surface-container-low/70 px-4 py-3"
										key={phone.id}
									>
										<div className="flex items-center justify-between gap-3">
											<span className="min-w-0 truncate text-body-md text-on-surface">
												<span className="font-medium">{phone.owner ?? phone.name}</span>{" "}
												<span className="text-on-surface-variant">
													{phone.model ?? phone.name} · {phone.id}
												</span>
											</span>
											<Button
												isDisabled={checkMutation.isPending || !status.team}
												onPress={() => checkMutation.mutate(phone.id)}
												size="sm"
												variant="secondary"
											>
												{checking ? <Spinner size="sm" /> : null}
												{checking ? "Signing…" : "Check"}
											</Button>
										</div>
										{checking ? (
											<p className="mt-1.5 text-body-sm text-on-surface-variant">
												Building and signing YoqaRunner; the first build can take a few minutes.
											</p>
										) : check ? (
											<p
												className={[
													"mt-1.5 text-body-sm",
													check.ok ? "text-success" : "text-error",
												].join(" ")}
											>
												{check.message}
											</p>
										) : null}
									</div>
								);
							})
						)}
					</div>
				</>
			)}

			<div className="mt-4 rounded-xl border border-outline-variant bg-surface-container-low/70 px-4 py-3.5 text-body-sm text-on-surface">
				<p className="font-semibold">Personal team (free Apple ID)</p>
				<ul className="mt-1 list-disc space-y-0.5 pl-5 text-on-surface-variant">
					<li>Profiles last 7 days and cover up to 3 devices; Check renews them.</li>
					<li>Keep the iPhone cabled and unlocked so Xcode can register it.</li>
					<li>
						On first use, trust the developer in Settings › General › VPN & Device Management.
					</li>
				</ul>
				<p className="mt-3 font-semibold">Paid team</p>
				<ul className="mt-1 list-disc space-y-0.5 pl-5 text-on-surface-variant">
					<li>Xcode registers the iPhone in the team's developer account on the first build.</li>
				</ul>
			</div>
		</>
	);
}
