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
	"inline-flex items-center justify-center rounded-[10px] border border-outline-variant bg-surface-bright text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50";
const STEP_BTN =
	"inline-flex size-10 items-center justify-center bg-surface-bright text-lg text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50";

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
			className="flex flex-col gap-3.5 rounded-[18px] border border-outline-variant bg-surface-bright p-4"
		>
			<div className="flex flex-col gap-0.5">
				<h2 id="inspector-gestures-heading" className="m-0 text-subheading text-on-surface">
					Screen gestures
				</h2>
				<p className="m-0 text-body-sm text-on-surface-variant">
					Don’t need an element — they act on the whole screen.
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-5">
				<fieldset
					aria-label="Swipe"
					className="m-0 grid min-w-0 grid-cols-[repeat(3,44px)] grid-rows-[repeat(3,44px)] gap-1 border-0 p-0"
				>
					<span />
					{swipe("up")}
					<span />
					{swipe("left")}
					<span className="flex items-center justify-center text-[11px] font-semibold text-on-surface-variant">
						Swipe
					</span>
					{swipe("right")}
					<span />
					{swipe("down")}
					<span />
				</fieldset>
				<div className="flex min-w-35 flex-1 flex-col gap-2">
					<span id="inspector-wait-label" className="text-body-sm font-semibold text-on-surface">
						Wait
					</span>
					<fieldset
						aria-labelledby="inspector-wait-label"
						className="m-0 flex w-fit min-w-0 items-center overflow-hidden rounded-[10px] border border-outline-variant p-0"
					>
						<button
							type="button"
							aria-label="Less time"
							className={STEP_BTN}
							disabled={disabled || wait <= MIN_WAIT}
							onClick={() => setWait((value) => Math.max(MIN_WAIT, value - 1))}
						>
							−
						</button>
						<span className="min-w-13 text-center font-mono text-body-md text-on-surface">
							{wait} s
						</span>
						<button
							type="button"
							aria-label="More time"
							className={STEP_BTN}
							disabled={disabled || wait >= MAX_WAIT}
							onClick={() => setWait((value) => Math.min(MAX_WAIT, value + 1))}
						>
							+
						</button>
					</fieldset>
					<button
						type="button"
						className={[PAD_BTN, "min-h-10 w-fit gap-1.5 px-3.5 text-body-md font-semibold"].join(
							" ",
						)}
						disabled={disabled}
						onClick={() => {
							onAddWait(wait);
						}}
					>
						<svg
							aria-hidden="true"
							className="size-4"
							fill="none"
							stroke="currentColor"
							strokeLinecap="round"
							strokeWidth="2"
							viewBox="0 0 24 24"
						>
							<path d="M12 5v14M5 12h14" />
						</svg>
						Add wait
					</button>
				</div>
			</div>
		</section>
	);
}
