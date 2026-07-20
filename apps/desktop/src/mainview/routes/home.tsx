import { createRunnerClient } from "@qa-agent/runner-client";
import { StatusBadge } from "@qa-agent/ui";
import { useQuery } from "@tanstack/react-query";

const client = createRunnerClient();

export function HomePage() {
	const healthQuery = useQuery({
		queryKey: ["runner-health"],
		queryFn: () => client.health(),
		retry: false,
		refetchInterval: 5000,
	});

	return (
		<section className="space-y-6">
			<div>
				<h1 className="text-xl font-medium">Runner status</h1>
				<p className="mt-1 text-sm text-qa-ink/65">
					Polls <code className="text-qa-accent">GET /health</code> on the local Bun runner.
				</p>
			</div>

			{healthQuery.isLoading ? <StatusBadge label="Checking runner…" tone="neutral" /> : null}

			{healthQuery.isError ? (
				<div className="space-y-2">
					<StatusBadge label="Runner unreachable" tone="warn" />
					<p className="text-sm text-qa-ink/70">
						Start it with <code>bun run runner</code>, then <code>bun run health</code>.
					</p>
				</div>
			) : null}

			{healthQuery.data ? (
				<div className="space-y-2">
					<StatusBadge label="Runner healthy" tone="ok" />
					<pre className="overflow-auto rounded-sm bg-qa-ink/5 p-4 text-xs leading-relaxed">
						{JSON.stringify(healthQuery.data, null, 2)}
					</pre>
				</div>
			) : null}

			<div className="pt-4">
				<StatusBadge label="Active device" tone="neutral">
					<span>none (connect in a later ticket)</span>
				</StatusBadge>
			</div>
		</section>
	);
}
