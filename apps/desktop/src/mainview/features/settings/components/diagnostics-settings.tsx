import {
	DoctorSeverityPill,
	DoctorStatusPill,
	doctorStatusRowClass,
	doctorStepSeverityClass,
} from "@/features/doctor/components/status-ui";
import { useDoctorReport, useRepairDoctor } from "@/features/doctor/hooks/usequery/use-doctor";
import { SectionCard } from "@/features/settings/components/section-card";
import { Button, Spinner } from "@heroui/react";

export function DiagnosticsSettings({ enabled }: { enabled: boolean }) {
	const doctorQuery = useDoctorReport();
	const repairMutation = useRepairDoctor();

	const runDoctor = () => {
		if (!enabled || doctorQuery.isFetching || repairMutation.isPending) return;
		void doctorQuery.refetch();
	};

	const statusLabel = doctorQuery.isFetching
		? "Running checks…"
		: !doctorQuery.data
			? "Not run yet"
			: doctorQuery.data.ok
				? "All required checks passed"
				: "Some required checks need attention";

	return (
		<div className="flex flex-col gap-6">
			<p className="text-body-md text-on-surface-variant">
				System checks for Java, Xcode, adb, and the device session. Same report as{" "}
				<code className="font-mono text-helper">yoqa doctor</code>.
			</p>

			<SectionCard>
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3 className="text-subheading font-semibold text-on-surface">Doctor report</h3>
						<p
							className={[
								"mt-2 inline-flex rounded-full px-3 py-1 text-body-sm font-semibold",
								doctorQuery.isFetching || !doctorQuery.data
									? "bg-surface-container text-on-surface-variant"
									: doctorQuery.data.ok
										? "bg-secondary-container text-on-secondary-container"
										: (doctorQuery.data.checks.some((c) => c.status === "fail") ?? false)
											? "bg-error-container text-on-error-container"
											: "bg-warning-container text-on-warning-container",
							].join(" ")}
						>
							{statusLabel}
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							isDisabled={!enabled || doctorQuery.isFetching || repairMutation.isPending}
							onPress={runDoctor}
							variant="secondary"
						>
							{doctorQuery.isFetching ? (
								<>
									<Spinner aria-label="Running diagnostics" color="current" size="sm" />
									{doctorQuery.data ? "Refreshing…" : "Running…"}
								</>
							) : doctorQuery.data ? (
								"Refresh"
							) : (
								"Run doctor"
							)}
						</Button>
						<Button
							isDisabled={
								repairMutation.isPending || !doctorQuery.data?.steps.some((step) => step.repair)
							}
							onPress={() => {
								if (doctorQuery.data) repairMutation.mutate(doctorQuery.data);
							}}
							variant="primary"
						>
							{repairMutation.isPending ? (
								<>
									<Spinner aria-label="Repairing" color="current" size="sm" />
									Repairing…
								</>
							) : (
								"Repair safe issues"
							)}
						</Button>
					</div>
				</div>

				{doctorQuery.isError ? (
					<p className="text-body-md text-error">
						Could not load doctor report. Is the local runner up?
					</p>
				) : !doctorQuery.data && !doctorQuery.isFetching ? (
					<p className="text-body-md text-on-surface-variant">
						Click Run doctor to generate a diagnostics report.
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{(doctorQuery.data?.checks ?? []).map((check) => (
							<li
								className={[
									"flex items-start justify-between gap-3 rounded-xl px-3.5 py-3",
									doctorStatusRowClass(check.status),
								].join(" ")}
								key={check.id}
							>
								<div className="min-w-0">
									<p className="text-body-md font-medium text-on-surface">{check.label}</p>
									{check.detail ? (
										<p className="mt-0.5 text-body-sm text-on-surface-variant">{check.detail}</p>
									) : null}
									{check.fixHint && check.status !== "pass" ? (
										<p className="mt-1 text-helper text-on-surface-variant">{check.fixHint}</p>
									) : null}
								</div>
								<DoctorStatusPill status={check.status} />
							</li>
						))}
					</ul>
				)}
			</SectionCard>

			{doctorQuery.data && doctorQuery.data.steps.length > 0 ? (
				<SectionCard>
					<h3 className="text-subheading font-semibold text-on-surface">Next steps</h3>
					<ul className="mt-3 flex flex-col gap-2">
						{doctorQuery.data.steps.map((step) => (
							<li
								className={[
									"flex items-start justify-between gap-3 rounded-xl px-3.5 py-3",
									doctorStepSeverityClass(step.severity),
								].join(" ")}
								key={`${step.title}-${step.detail}`}
							>
								<div className="min-w-0">
									<p className="text-body-md font-medium text-on-surface">{step.title}</p>
									<p className="mt-0.5 text-body-sm text-on-surface-variant">{step.detail}</p>
								</div>
								<DoctorSeverityPill severity={step.severity} />
							</li>
						))}
					</ul>
				</SectionCard>
			) : null}
		</div>
	);
}
