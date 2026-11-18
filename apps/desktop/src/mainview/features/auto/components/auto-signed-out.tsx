import { Link } from "@tanstack/react-router";

/**
 * Auto talks only to the Claude Provider; until it is signed in (CLI login or API key) the
 * screen says so and points at Settings › Provider. It never falls back to another Provider.
 */
export function AutoSignedOut({ detail }: { detail: string }) {
	return (
		<div className="motion-fade-up flex h-full items-center justify-center px-4">
			<div className="flex max-w-md flex-col items-center gap-3 rounded-[var(--radius)] border border-outline-variant bg-surface-container-lowest px-8 py-10 text-center">
				<h2 className="m-0 text-subheading text-on-surface">Sign in to Claude to use Auto</h2>
				<p className="m-0 text-body-sm text-on-surface-variant">
					Auto's chat agent runs on the Claude Provider, with a Claude Code login or an Anthropic
					API key.
				</p>
				{detail ? <p className="m-0 text-helper text-outline">{detail}</p> : null}
				<Link
					className="mt-2 inline-flex min-h-10 items-center rounded-[var(--radius)] bg-primary px-4 text-body-md font-semibold text-on-primary transition-opacity hover:opacity-90"
					search={{ section: "provider" }}
					to="/settings"
				>
					Open Settings › Provider
				</Link>
			</div>
		</div>
	);
}
