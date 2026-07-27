import { Button, Input, Label, TextField } from "@heroui/react";
import { useState } from "react";

type CommandBarProps = {
	disabled: boolean;
	onAddSwipe: (direction: "up" | "down" | "left" | "right") => void;
	onAddWait: (seconds: number) => void;
};

/** Global (non-element) script helpers — swipe + wait. Element actions live on the screenshot menu. */
export function CommandBar({ disabled, onAddSwipe, onAddWait }: CommandBarProps) {
	const [waitSeconds, setWaitSeconds] = useState("1");

	return (
		<div className="flex flex-col gap-2 rounded-xl border border-outline-variant/30 bg-surface-container/40 px-3 py-2.5">
			<p className="text-helper text-on-surface-variant">
				Screen gestures — select an element on the device for tap, assert, and input.
			</p>
			<div className="flex flex-wrap items-end gap-2">
				{(["up", "down", "left", "right"] as const).map((direction) => (
					<Button
						key={direction}
						size="sm"
						variant="secondary"
						isDisabled={disabled}
						onPress={() => {
							onAddSwipe(direction);
						}}
					>
						Swipe {direction}
					</Button>
				))}

				<TextField className="w-24" value={waitSeconds} onChange={setWaitSeconds}>
					<Label className="mb-1 text-helper text-on-surface-variant">Wait (s)</Label>
					<Input inputMode="decimal" />
				</TextField>
				<Button
					size="sm"
					variant="secondary"
					isDisabled={disabled}
					onPress={() => {
						const seconds = Number(waitSeconds);
						if (!Number.isFinite(seconds) || seconds < 0) return;
						onAddWait(seconds);
					}}
				>
					Add wait
				</Button>
			</div>
		</div>
	);
}
