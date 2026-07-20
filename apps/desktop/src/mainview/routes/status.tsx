import { createRunnerClient } from "@qa-agent/runner-client";
import { StatusBadge } from "@qa-agent/ui";
import { useQuery } from "@tanstack/react-query";

const client = createRunnerClient();

export function StatusPage() {
	const healthQuery = useQuery({
		queryKey: ["runner-health"],
		queryFn: () => client.health(),
		retry: false,
		refetchInterval: 5000,
	});

	return (
		<section className="space-y-stack-md">
			<div>
				<h1 className="text-headline-lg tracking-tight text-on-surface">Runner status</h1>
				<p className="mt-1 text-body-md text-on-surface-variant">
					Polls <code className="text-secondary">GET /health</code> on the local Bun runner.
				</p>
			</div>

			{healthQuery.isLoading ? <StatusBadge label="Checking runner…" tone="neutral" /> : null}

			{healthQuery.isError ? (
				<div className="space-y-stack-sm">
					<StatusBadge label="Runner unreachable" tone="warn" />
					<p className="text-body-sm text-on-surface-variant">
						Start it with <code>bun run runner</code>, then <code>bun run health</code>.
					</p>
				</div>
			) : null}

			{healthQuery.data ? (
				<div className="space-y-stack-sm">
					<StatusBadge label="Runner healthy" tone="ok" />
					<pre className="overflow-auto rounded border border-outline-variant bg-surface-container-low p-4 text-helper leading-relaxed text-on-surface">
						{JSON.stringify(healthQuery.data, null, 2)}
					</pre>
				</div>
			) : null}

			<div className="pt-stack-md">
				<StatusBadge label="Active device" tone="neutral">
					<span>none (connect in a later ticket)</span>
				</StatusBadge>
			</div>
		</section>
	);
}
