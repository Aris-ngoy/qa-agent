import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, type SVGProps, useMemo, useState } from "react";
import { type CaseStatus, MOCK_CASES, TOTAL_CASES } from "../test-cases-data";

type MetricAccent = "lavender" | "mint" | "rose" | "neutral";

type MetricCardProps = {
	label: string;
	value: string;
	accent?: MetricAccent;
	icon: ReactNode;
};

function Icon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-5"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		/>
	);
}

function MetricCard({ label, value, accent = "neutral", icon }: MetricCardProps) {
	const bg =
		accent === "lavender"
			? "bg-card-lavender"
			: accent === "mint"
				? "bg-card-mint"
				: accent === "rose"
					? "bg-card-rose"
					: "bg-surface-container-lowest";

	return (
		<div className={`flex h-32 flex-col justify-between rounded-2xl p-5 shadow-card ${bg}`}>
			<div className="flex items-start justify-between">
				<span className="text-label-caps uppercase tracking-widest text-primary/60">{label}</span>
				<span className="text-primary/70">{icon}</span>
			</div>
			<p className="text-[2rem] font-bold leading-none tracking-tight text-primary">{value}</p>
		</div>
	);
}

function CaseStatusPill({ status }: { status: CaseStatus }) {
	if (status === "passed") {
		return (
			<span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/70 px-3 py-1 text-helper font-semibold text-on-secondary-container">
				<span className="size-1.5 rounded-full bg-secondary" />
				Passed
			</span>
		);
	}

	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-error-container/70 px-3 py-1 text-helper font-semibold text-on-error-container">
			<span className="size-1.5 rounded-full bg-error" />
			Errored
		</span>
	);
}

export function TestCasesPage() {
	const navigate = useNavigate();
	const [filter, setFilter] = useState("");

	const rows = useMemo(() => {
		const query = filter.trim().toLowerCase();
		if (!query) {
			return MOCK_CASES;
		}
		return MOCK_CASES.filter((row) => {
			const haystack = `${row.name} ${row.suite} ${row.status}`.toLowerCase();
			return haystack.includes(query);
		});
	}, [filter]);

	const openCase = (caseId: string) => {
		void navigate({ to: "/test-cases/$caseId", params: { caseId } });
	};

	return (
		<div className="flex w-full flex-col gap-8 pb-4">
			<div className="flex flex-wrap items-center gap-6">
				<div className="min-w-[10rem]">
					<h1 className="text-headline-lg text-on-surface">Test Cases</h1>
					<p className="text-body-sm text-on-surface-variant">
						Automated regression suites for this app
					</p>
				</div>
				<label className="relative mx-auto min-w-[16rem] max-w-xl flex-1">
					<span className="sr-only">Filter test cases</span>
					<span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5 text-on-surface-variant">
						<svg
							aria-hidden="true"
							className="size-4"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.75"
							viewBox="0 0 24 24"
						>
							<path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" />
						</svg>
					</span>
					<input
						className="w-full rounded-full border-none bg-surface-container-lowest py-3.5 pl-12 pr-5 text-body-md text-on-surface shadow-card placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/10"
						onChange={(event) => setFilter(event.target.value)}
						placeholder="Filter by name, suite, or status…"
						type="search"
						value={filter}
					/>
				</label>
				<div className="flex items-center gap-2">
					<button
						className="inline-flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-subheading text-on-secondary shadow-card transition-opacity hover:opacity-90"
						type="button"
					>
						<svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 24 24">
							<path d="M8 5.5v13l11-6.5L8 5.5Z" />
						</svg>
						Run suite
					</button>
					<button
						className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-subheading text-on-primary shadow-float transition-transform hover:scale-[1.02]"
						type="button"
					>
						<svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 20 20">
							<path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
						</svg>
						Add case
					</button>
				</div>
			</div>

			<section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
				<MetricCard
					accent="lavender"
					icon={
						<Icon>
							<path
								d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
								strokeLinejoin="round"
							/>
						</Icon>
					}
					label="Total Suites"
					value="124"
				/>
				<MetricCard
					accent="mint"
					icon={
						<Icon>
							<path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
							<circle cx="12" cy="12" r="8" />
						</Icon>
					}
					label="Success Rate"
					value="98.2%"
				/>
				<MetricCard
					accent="neutral"
					icon={
						<Icon>
							<circle cx="12" cy="12" r="8" />
							<path d="M12 8v4l2.5 1.5" strokeLinecap="round" />
						</Icon>
					}
					label="Avg. Run Time"
					value="2m 14s"
				/>
				<MetricCard
					accent="rose"
					icon={
						<Icon>
							<path
								d="M12 9v4M12 17h.01M10.3 4.9L2.8 18a2 2 0 001.7 3h15a2 2 0 001.7-3L13.7 4.9a2 2 0 00-3.4 0z"
								strokeLinejoin="round"
							/>
						</Icon>
					}
					label="Failures (24h)"
					value="3"
				/>
			</section>

			<div className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-soft">
				<table className="w-full border-collapse text-left">
					<thead>
						<tr className="border-b border-outline-variant/70">
							<th className="px-6 py-4 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Name
							</th>
							<th className="px-6 py-4 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Created
							</th>
							<th className="px-6 py-4 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Last Run
							</th>
							<th className="px-6 py-4 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Status
							</th>
							<th className="px-6 py-4">
								<span className="sr-only">Actions</span>
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-outline-variant/50 text-body-md">
						{rows.length === 0 ? (
							<tr>
								<td className="px-6 py-8 text-body-md text-on-surface-variant" colSpan={5}>
									No test cases match “{filter.trim()}”.
								</td>
							</tr>
						) : (
							rows.map((row) => (
								<tr
									className="cursor-pointer transition-colors hover:bg-surface-container-low"
									key={row.id}
									onClick={() => openCase(row.id)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											openCase(row.id);
										}
									}}
									tabIndex={0}
								>
									<td className="px-6 py-4">
										<div className="flex items-center gap-3">
											<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card-lavender text-body-sm font-semibold text-primary">
												{row.name.slice(0, 1)}
											</span>
											<div>
												<div className="font-semibold text-on-surface">{row.name}</div>
												<div className="text-helper text-on-surface-variant">
													suite: {row.suite}
												</div>
											</div>
										</div>
									</td>
									<td className="px-6 py-4 text-on-surface-variant">{row.created}</td>
									<td className="px-6 py-4 text-on-surface-variant">{row.lastRun}</td>
									<td className="px-6 py-4">
										<CaseStatusPill status={row.status} />
									</td>
									<td className="px-6 py-4 text-right">
										<span className="inline-flex rounded-full p-1.5 text-on-surface-variant">
											<svg
												aria-hidden="true"
												className="size-5"
												fill="currentColor"
												viewBox="0 0 24 24"
											>
												<circle cx="12" cy="5" r="1.5" />
												<circle cx="12" cy="12" r="1.5" />
												<circle cx="12" cy="19" r="1.5" />
											</svg>
										</span>
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>

				<div className="flex items-center justify-between border-t border-outline-variant/70 px-6 py-4">
					<span className="text-body-sm text-on-surface-variant">
						Showing {rows.length === 0 ? "0" : `1-${rows.length}`} of {TOTAL_CASES} test cases
					</span>
					<div className="flex gap-2">
						<button
							className="rounded-full border border-outline-variant bg-surface-container-lowest px-4 py-1.5 text-body-sm text-on-surface-variant opacity-50"
							disabled
							type="button"
						>
							Previous
						</button>
						<button
							className="rounded-full border border-outline-variant bg-surface-container-lowest px-4 py-1.5 text-body-sm text-on-surface-variant transition-colors hover:bg-surface-container-high"
							type="button"
						>
							Next
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
