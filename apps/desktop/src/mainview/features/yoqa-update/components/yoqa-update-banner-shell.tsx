import { openExternalUrl } from "@/app/desktop-rpc";
import type { ReactNode } from "react";

const TONE_CLASSES = {
	ready: "bg-secondary-container text-on-secondary-container",
	failed: "bg-error-container text-on-error-container",
} as const;

/**
 * The Yoqa update banner's frame: a headline, a link that opens in the default browser, and
 * optional actions on the right.
 */
export function YoqaUpdateBannerShell({
	tone,
	headline,
	link,
	children,
}: {
	tone: keyof typeof TONE_CLASSES;
	headline: string;
	link: { href: string; label: string };
	children?: ReactNode;
}) {
	return (
		<output
			aria-live="polite"
			className={`motion-fade-up flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-2.5 shadow-card ${TONE_CLASSES[tone]}`}
		>
			<p className="text-body-md">
				<span className="font-semibold">{headline}</span>
				<a
					className="ml-3 text-body-sm font-medium underline-offset-2 hover:underline"
					href={link.href}
					onClick={(event) => {
						event.preventDefault();
						void openExternalUrl(link.href);
					}}
					rel="noreferrer"
				>
					{link.label}
				</a>
			</p>
			{children}
		</output>
	);
}
