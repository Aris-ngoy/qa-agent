import { type ReactNode, type SVGProps, useMemo, useState } from "react";

type CaseStatus = "passed" | "errored";

type TestCaseRow = {
	id: string;
	name: string;
	suite: string;
	created: string;
	lastRun: string;
	status: CaseStatus;
};

const MOCK_CASES: TestCaseRow[] = [
	{
		id: "tc_login",
		name: "Login Flow Validation",
		suite: "core-auth",
		created: "Oct 24, 2023",
		lastRun: "2 mins ago",
		status: "passed",
	},
	{
		id: "tc_checkout",
		name: "Checkout API Integration",
		suite: "ecommerce",
		created: "Nov 12, 2023",
		lastRun: "14 mins ago",
		status: "errored",
	},
	{
		id: "tc_settings",
		name: "User Settings Persistence",
		suite: "account",
		created: "Nov 15, 2023",
		lastRun: "1 hour ago",
		status: "passed",
	},
	{
		id: "tc_search",
		name: "Search Index Consistency",
		suite: "data-sync",
		created: "Dec 02, 2023",
		lastRun: "3 hours ago",
		status: "passed",
	},
	{
		id: "tc_onboarding",
		name: "Onboarding Carousel UI",
		suite: "growth",
		created: "Dec 05, 2023",
		lastRun: "Yesterday",
		status: "errored",
	},
];

const TOTAL_CASES = 124;

type MetricAccent = "none" | "success" | "error";

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

function MetricCard({ label, value, accent = "none", icon }: MetricCardProps) {
	const accentClass =
		accent === "success"
			? "border-l-4 border-l-secondary"
			: accent === "error"
				? "border-l-4 border-l-error"
				: "";

	return (
		<div
			className={`flex h-32 flex-col justify-between rounded-md border border-outline-variant bg-surface-container-lowest p-5 transition-shadow hover:shadow-sm ${accentClass}`}
		>
			<div className="flex items-start justify-between">
				<span className="text-label-caps uppercase tracking-widest text-on-surface-variant">
					{label}
				</span>
				<span
					className={
						accent === "success"
							? "text-secondary"
							: accent === "error"
								? "text-error"
								: "text-on-surface-variant"
					}
				>
					{icon}
				</span>
			</div>
			<p className="text-[2rem] font-bold leading-none tracking-tight text-on-surface">{value}</p>
		</div>
	);
}

function CaseStatusPill({ status }: { status: CaseStatus }) {
	if (status === "passed") {
		return (
			<span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container px-2.5 py-0.5 text-helper font-semibold text-on-secondary-container">
				<span className="size-1.5 rounded-full bg-secondary" />
				Passed
			</span>
		);
	}

	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-error-container px-2.5 py-0.5 text-helper font-semibold text-on-error-container">
			<span className="size-1.5 rounded-full bg-error" />
			Errored
		</span>
	);
}

export function TestCasesPage() {
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

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="mb-1 text-headline-lg text-primary">Test Cases</h1>
					<p className="text-body-md text-on-surface-variant">
						Manage and execute your automated regression suites.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<button
						className="rounded border border-outline-variant px-4 py-1.5 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high"
						type="button"
					>
						Export
					</button>
					<button
						className="rounded bg-secondary px-4 py-1.5 text-body-sm font-semibold text-on-secondary transition-opacity hover:opacity-90"
						type="button"
					>
						Run
					</button>
					<button
						className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2.5 text-subheading text-on-primary transition-colors hover:bg-primary-container"
						type="button"
					>
						<svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 20 20">
							<path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
						</svg>
						Add test case
					</button>
				</div>
			</div>

			<section className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-4">
				<MetricCard
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
					accent="success"
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
					accent="error"
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

			<div className="flex items-center gap-4 rounded-md border border-outline-variant bg-surface-container-lowest p-3">
				<label className="relative min-w-0 flex-1">
					<span className="sr-only">Filter test cases</span>
					<span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant">
						<svg
							aria-hidden="true"
							className="size-5"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.75"
							viewBox="0 0 24 24"
						>
							<path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" />
						</svg>
					</span>
					<input
						className="w-full rounded border-none bg-transparent py-2 pl-10 pr-4 text-body-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none"
						onChange={(event) => setFilter(event.target.value)}
						placeholder="Filter by name, status, or tag..."
						type="search"
						value={filter}
					/>
				</label>
				<div className="hidden h-6 w-px bg-outline-variant sm:block" />
				<button
					className="hidden items-center gap-2 rounded px-3 py-2 text-body-sm text-on-surface-variant transition-colors hover:bg-surface-container-low sm:inline-flex"
					type="button"
				>
					<svg
						aria-hidden="true"
						className="size-[18px]"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.75"
						viewBox="0 0 24 24"
					>
						<path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
					</svg>
					Filter
				</button>
				<button
					className="hidden items-center gap-2 rounded px-3 py-2 text-body-sm text-on-surface-variant transition-colors hover:bg-surface-container-low sm:inline-flex"
					type="button"
				>
					<svg
						aria-hidden="true"
						className="size-[18px]"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.75"
						viewBox="0 0 24 24"
					>
						<path
							d="M3 6h6M3 12h10M3 18h14M17 4v4M21 8l-4 4-4-4"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
					Sort
				</button>
			</div>

			<div className="overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest shadow-sm">
				<table className="w-full border-collapse text-left">
					<thead>
						<tr className="border-b border-outline-variant bg-surface-container-low">
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
					<tbody className="divide-y divide-outline-variant text-body-md">
						{rows.length === 0 ? (
							<tr>
								<td className="px-6 py-8 text-body-md text-on-surface-variant" colSpan={5}>
									No test cases match “{filter.trim()}”.
								</td>
							</tr>
						) : (
							rows.map((row) => (
								<tr className="transition-colors hover:bg-surface-container-low" key={row.id}>
									<td className="px-6 py-4">
										<div className="flex items-center gap-3">
											<svg
												aria-hidden="true"
												className="size-5 shrink-0 text-on-surface-variant"
												fill="none"
												stroke="currentColor"
												strokeWidth="1.75"
												viewBox="0 0 24 24"
											>
												<path
													d="M8 4h6l4 4v12a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2z"
													strokeLinejoin="round"
												/>
												<path d="M14 4v4h4" strokeLinejoin="round" />
											</svg>
											<div>
												<div className="font-semibold text-primary">{row.name}</div>
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
										<button
											aria-label={`More actions for ${row.name}`}
											className="rounded p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high"
											type="button"
										>
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
										</button>
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>

				<div className="flex items-center justify-between border-t border-outline-variant bg-surface-container-low px-6 py-4">
					<span className="text-body-sm text-on-surface-variant">
						Showing {rows.length === 0 ? "0" : `1-${rows.length}`} of {TOTAL_CASES} test cases
					</span>
					<div className="flex gap-2">
						<button
							className="rounded border border-outline-variant bg-surface-container-lowest px-3 py-1 text-body-sm text-on-surface-variant opacity-50"
							disabled
							type="button"
						>
							Previous
						</button>
						<button
							className="rounded border border-outline-variant bg-surface-container-lowest px-3 py-1 text-body-sm text-on-surface-variant transition-colors hover:bg-surface-container-high"
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
