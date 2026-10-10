import { Button } from "@heroui/react";
import { type SVGProps, useState } from "react";

type Direction = "up" | "down" | "left" | "right";

type ScreenGesturesProps = {
	disabled: boolean;
	onAddSwipe: (direction: Direction) => void;
	onAddWait: (seconds: number) => void;
};

const MIN_WAIT = 1;
const MAX_WAIT = 60;

function Arrow({ direction, ...props }: { direction: Direction } & SVGProps<SVGSVGElement>) {
	const rotation = { up: 0, right: 90, down: 180, left: 270 }[direction];
	return (
		<svg
			aria-hidden="true"
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			style={{ transform: `rotate(${rotation}deg)` }}
			{...props}
		>
			<path d="M12 19V5M5 12l7-7 7 7" />
		</svg>
	);
}

const PAD_BTN =
	"inline-flex size-9 items-center justify-center rounded-lg text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50";

/** Global (non-element) script helpers — swipe + wait. Element / app actions live on the Selected element card. */
export function ScreenGestures({ disabled, onAddSwipe, onAddWait }: ScreenGesturesProps) {
	const [wait, setWait] = useState(1);

	const swipe = (direction: Direction) => (
		<button
			type="button"
			aria-label={`Swipe ${direction}`}
			className={PAD_BTN}
			disabled={disabled}
			onClick={() => {
				onAddSwipe(direction);
			}}
		>
			<Arrow direction={direction} />
		</button>
	);

	return (
		<section
			aria-labelledby="inspector-gestures-heading"
			className="flex flex-col gap-3 rounded-xl border border-outline-variant/30 bg-surface-container/40 p-3"
		>
			<div>
				<h2 id="inspector-gestures-heading" className="text-title-sm font-semibold text-on-surface">
					Screen gestures
				</h2>
				<p className="text-helper text-on-surface-variant">
					Don’t need an element — they act on the whole screen.
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
				<fieldset
					aria-label="Swipe"
					className="m-0 grid min-w-0 grid-cols-3 place-items-center border-0 p-0"
				>
					<span />
					{swipe("up")}
					<span />
					{swipe("left")}
					<span className="text-helper text-on-surface-variant">Swipe</span>
					{swipe("right")}
					<span />
					{swipe("down")}
					<span />
				</fieldset>
				<div className="flex flex-col gap-1.5">
					<span id="inspector-wait-label" className="text-helper text-on-surface-variant">
						Wait
					</span>
					<fieldset
						aria-labelledby="inspector-wait-label"
						className="m-0 flex min-w-0 items-center gap-1 border-0 p-0"
					>
						<button
							type="button"
							aria-label="Less time"
							className={PAD_BTN}
							disabled={disabled || wait <= MIN_WAIT}
							onClick={() => setWait((value) => Math.max(MIN_WAIT, value - 1))}
						>
							−
						</button>
						<span className="min-w-12 text-center font-mono text-body-sm text-on-surface">
							{wait} s
						</span>
						<button
							type="button"
							aria-label="More time"
							className={PAD_BTN}
							disabled={disabled || wait >= MAX_WAIT}
							onClick={() => setWait((value) => Math.min(MAX_WAIT, value + 1))}
						>
							+
						</button>
					</fieldset>
					<Button
						size="sm"
						variant="secondary"
						isDisabled={disabled}
						onPress={() => {
							onAddWait(wait);
						}}
					>
						Add wait
					</Button>
				</div>
			</div>
		</section>
	);
}
