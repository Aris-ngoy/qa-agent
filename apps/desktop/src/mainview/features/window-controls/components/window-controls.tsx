import type { ReactNode } from "react";
import { closeWindow, minimizeWindow } from "../data/api/window";
import { useWindowMaximized } from "../hooks/use-window-maximized";
import { needsCustomWindowControls } from "../utils/platform";

const showControls =
	typeof navigator !== "undefined" && needsCustomWindowControls(navigator.userAgent);

/** Minimize / Maximize / Close for Windows, pinned top-right over the drag region. */
export function WindowControls() {
	if (!showControls) return null;
	return <WindowControlButtons />;
}

function WindowControlButtons() {
	const { maximized, toggle } = useWindowMaximized();

	return (
		<div className="electrobun-webkit-app-region-no-drag fixed top-0 right-0 z-50 flex h-8 text-on-surface">
			<CaptionButton label="Minimize" onClick={() => void minimizeWindow()}>
				<path d="M0 5.5h10" />
			</CaptionButton>
			<CaptionButton label={maximized ? "Restore" : "Maximize"} onClick={toggle}>
				{maximized ? (
					<>
						<path d="M2.5 2.5V.5h7v7h-2" />
						<rect x="0.5" y="2.5" width="7" height="7" />
					</>
				) : (
					<rect x="0.5" y="0.5" width="9" height="9" />
				)}
			</CaptionButton>
			<CaptionButton label="Close" danger onClick={() => void closeWindow()}>
				<path d="M.5.5l9 9M9.5.5l-9 9" />
			</CaptionButton>
		</div>
	);
}

function CaptionButton({
	label,
	danger = false,
	onClick,
	children,
}: {
	label: string;
	danger?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className={`flex h-8 w-[46px] items-center justify-center transition-colors ${
				danger ? "hover:bg-error hover:text-on-error" : "hover:bg-on-surface/10"
			}`}
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 10 10"
				className="size-2.5 overflow-visible"
				fill="none"
				stroke="currentColor"
				strokeWidth="1"
			>
				{children}
			</svg>
		</button>
	);
}
