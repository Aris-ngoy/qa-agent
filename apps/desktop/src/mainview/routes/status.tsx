import { createRunnerClient } from "@qa-agent/runner-client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type SVGProps, useState } from "react";

const client = createRunnerClient();

const METRIC_CARDS = [
	{
		id: "cases",
		label: "Regression",
		value: "124",
		meta: "test cases",
		tone: "lavender" as const,
		chip: "Active",
	},
	{
		id: "pass",
		label: "Last 24h",
		value: "98.2%",
		meta: "pass rate",
		tone: "mint" as const,
		chip: "Healthy",
	},
	{
		id: "fail",
		label: "Open",
		value: "3",
		meta: "failures",
		tone: "rose" as const,
		chip: "P0–P1",
	},
];

const CHART_COLUMNS = [
	{ id: "w1-mon", passed: 81, failed: 4, label: "Mon" },
	{ id: "w1-tue", passed: 32, failed: 11, label: "Tue" },
	{ id: "w1-wed", passed: 54, failed: 6, label: "Wed" },
	{ id: "w1-thu", passed: 42, failed: 2, label: "Thu" },
	{ id: "w1-fri", passed: 68, failed: 5, label: "Fri" },
	{ id: "w1-sat", passed: 29, failed: 8, label: "Sat" },
	{ id: "w1-sun", passed: 55, failed: 3, label: "Sun" },
	{ id: "w2-mon", passed: 38, failed: 7, label: "Mon" },
	{ id: "w2-tue", passed: 72, failed: 4, label: "Tue" },
	{ id: "w2-wed", passed: 47, failed: 9, label: "Wed" },
	{ id: "w2-thu", passed: 61, failed: 2, label: "Thu" },
	{ id: "w2-fri", passed: 35, failed: 6, label: "Fri" },
];

type RunStatus = "running" | "passed" | "failed";

const LAST_RUNS: {
	id: string;
	name: string;
	duration: string;
	status: RunStatus;
	device: string;
	when: string;
	initial: string;
}[] = [
	{
		id: "run_8921",
		name: "Login Flow Validation",
		duration: "2.4s",
		status: "running",
		device: "iPhone 16",
		when: "Just now",
		initial: "L",
	},
	{
		id: "run_8920",
		name: "Checkout API Integration",
		duration: "4.8s",
		status: "passed",
		device: "Pixel 8",
		when: "10 min ago",
		initial: "C",
	},
	{
		id: "run_8919",
		name: "User Settings Persistence",
		duration: "1.1s",
		status: "failed",
		device: "iPhone 16",
		when: "1h ago",
		initial: "U",
	},
	{
		id: "run_8918",
		name: "Search Index Consistency",
		duration: "3.2s",
		status: "passed",
		device: "Pixel 8",
		when: "Yesterday",
		initial: "S",
	},
];

function SearchIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-4"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" />
		</svg>
	);
}

function StatusPill({ status }: { status: RunStatus }) {
	if (status === "running") {
		return (
			<span className="inline-flex items-center gap-1.5 rounded-full bg-tertiary-container/70 px-3 py-1 text-helper font-medium text-on-tertiary-container">
				<span className="size-1.5 animate-pulse rounded-full bg-tertiary" />
				Running
			</span>
		);
	}
	if (status === "passed") {
		return (
			<span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/70 px-3 py-1 text-helper font-medium text-on-secondary-container">
				<span className="size-1.5 rounded-full bg-secondary" />
				Passed
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-error-container/70 px-3 py-1 text-helper font-medium text-on-error-container">
			<span className="size-1.5 rounded-full bg-error" />
			Failed
		</span>
	);
}

function cardToneClass(tone: "lavender" | "mint" | "rose") {
	if (tone === "mint") return "bg-card-mint";
	if (tone === "rose") return "bg-card-rose";
	return "bg-card-lavender";
}

export function StatusPage() {
	const [filter, setFilter] = useState("");
	const healthQuery = useQuery({
		queryKey: ["runner-health"],
		queryFn: () => client.health(),
		retry: false,
		refetchInterval: 5000,
	});

	const runnerLabel = healthQuery.isLoading
		? "Checking local runner…"
		: healthQuery.isError
			? "Runner offline — start with bun run runner"
			: "Local runner healthy";

	return (
		<div className="flex w-full flex-col gap-8 pb-4">
			<div className="flex flex-wrap items-center gap-6">
				<div className="min-w-[10rem]">
					<h1 className="text-headline-lg text-on-surface">Status</h1>
					<p className="text-body-sm text-on-surface-variant">{runnerLabel}</p>
				</div>
				<label className="relative mx-auto min-w-[16rem] max-w-xl flex-1">
					<span className="sr-only">Search tests</span>
					<span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5 text-on-surface-variant">
						<SearchIcon />
					</span>
					<input
						className="w-full rounded-full border-none bg-surface-container-lowest py-3.5 pl-12 pr-5 text-body-md text-on-surface shadow-card placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/10"
						onChange={(event) => setFilter(event.target.value)}
						placeholder="Search tests, suites, or devices…"
						type="search"
						value={filter}
					/>
				</label>
			</div>

			<section className="flex items-center gap-4 overflow-x-auto pb-1">
				{METRIC_CARDS.map((card) => (
					<article
						className={`relative min-w-[11.5rem] flex-1 overflow-hidden rounded-2xl ${cardToneClass(card.tone)} p-5 shadow-card`}
						key={card.id}
					>
						<div className="mb-6 flex items-start justify-between">
							<span className="text-helper font-semibold uppercase tracking-wide text-primary/55">
								{card.label}
							</span>
							<span className="rounded-full bg-white/50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
								{card.chip}
							</span>
						</div>
						<p className="text-[1.75rem] font-bold leading-none tracking-tight text-primary">
							{card.value}
						</p>
						<p className="mt-3 text-helper capitalize text-primary/70">{card.meta}</p>
					</article>
				))}
				<button
					aria-label="Open test cases"
					className="flex size-12 shrink-0 items-center justify-center rounded-full border border-dashed border-primary/30 text-primary transition-colors hover:border-primary/60"
					type="button"
				>
					<svg
						aria-hidden="true"
						className="size-5"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						viewBox="0 0 24 24"
					>
						<path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
			</section>

			<section>
				<div className="mb-2 flex items-center justify-between">
					<h2 className="text-headline-md text-on-surface">Pass / Fail</h2>
					<Link
						className="text-body-sm text-on-surface-variant hover:text-on-surface"
						to="/test-cases"
					>
						View cases
					</Link>
				</div>
				<div className="mb-4 flex items-center gap-4 text-helper text-on-surface-variant">
					<span className="inline-flex items-center gap-1.5">
						<span className="size-2.5 rounded-full bg-card-mint" />
						Passed
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span className="size-2.5 rounded-full bg-card-rose" />
						Failed
					</span>
				</div>
				<div className="relative flex h-56 items-end justify-between gap-1 px-2 pb-6">
					<div className="pointer-events-none absolute inset-x-2 top-0 bottom-6 flex justify-between">
						{CHART_COLUMNS.map((col) => (
							<div className="w-px bg-outline-variant/50" key={`guide-${col.id}`} />
						))}
					</div>
					{CHART_COLUMNS.map((col) => {
						const passedH = Math.max(28, (col.passed / 90) * 88);
						const failedH = Math.max(20, (col.failed / 12) * 56);
						return (
							<div
								className="relative z-10 flex flex-1 flex-col items-center justify-end"
								key={col.id}
							>
								<div
									className="flex w-[72%] max-w-[2.75rem] items-center justify-center rounded-full bg-card-mint text-[10px] font-bold text-primary shadow-card"
									style={{ height: passedH }}
								>
									{col.passed}
								</div>
								<span className="my-1 size-1.5 rounded-full bg-primary" />
								<div
									className="flex w-[72%] max-w-[2.75rem] items-center justify-center rounded-full bg-card-rose text-[10px] font-bold text-primary shadow-card"
									style={{ height: failedH }}
								>
									{col.failed}
								</div>
							</div>
						);
					})}
				</div>
			</section>

			<section>
				<h2 className="mb-4 text-headline-md text-on-surface">Latest Runs</h2>
				<ul className="flex flex-col">
					{LAST_RUNS.filter((row) => {
						const q = filter.trim().toLowerCase();
						if (!q) return true;
						return `${row.name} ${row.status} ${row.device}`.toLowerCase().includes(q);
					}).map((row) => (
						<li
							className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-outline-variant/60 py-3.5 last:border-b-0 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:gap-6"
							key={row.id}
						>
							<div className="flex min-w-0 items-center gap-3">
								<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-body-sm font-semibold text-on-surface">
									{row.initial}
								</span>
								<div className="min-w-0">
									<p className="truncate text-body-md font-medium text-on-surface">{row.name}</p>
									<p className="truncate text-helper text-on-surface-variant sm:hidden">
										{row.device}
									</p>
								</div>
							</div>
							<span className="hidden text-body-sm text-on-surface-variant sm:block">
								{row.device}
							</span>
							<span className="text-body-md font-semibold tabular-nums text-on-surface">
								{row.duration}
							</span>
							<StatusPill status={row.status} />
							<span className="hidden text-body-sm text-on-surface-variant sm:block">
								{row.when}
							</span>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}
