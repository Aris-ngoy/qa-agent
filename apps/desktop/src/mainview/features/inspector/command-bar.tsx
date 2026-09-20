import { Button, Input, Label, TextField } from "@heroui/react";
import { useState } from "react";

type CommandBarProps = {
	disabled: boolean;
	onAddSwipe: (direction: "up" | "down" | "left" | "right") => void;
	onAddScroll: (direction: "up" | "down" | "left" | "right") => void;
	onAddBack: () => void;
	onAddHome: () => void;
	onAddDismissKeyboard: () => void;
	onAddWait: (seconds: number) => void;
};

/** Global (non-element) script helpers — swipe/scroll/system + wait. Element / app actions live on the screenshot menu. */
export function CommandBar({
	disabled,
	onAddSwipe,
	onAddScroll,
	onAddBack,
	onAddHome,
	onAddDismissKeyboard,
	onAddWait,
}: CommandBarProps) {
	const [waitSeconds, setWaitSeconds] = useState("1");

	return (
		<div className="flex flex-col gap-2 rounded-xl border border-outline-variant/30 bg-surface-container/40 px-3 py-2.5">
			<p className="text-helper text-on-surface-variant">
				Screen gestures — select an element on the device for tap, assert, input, and app control.
			</p>
			<div className="flex flex-wrap items-end gap-2">
				{(["up", "down", "left", "right"] as const).map((direction) => (
					<Button
						key={`swipe-${direction}`}
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
			<div className="flex flex-wrap items-center gap-2">
				{(["up", "down", "left", "right"] as const).map((direction) => (
					<Button
						key={`scroll-${direction}`}
						size="sm"
						variant="tertiary"
						isDisabled={disabled}
						onPress={() => {
							onAddScroll(direction);
						}}
					>
						Scroll {direction}
					</Button>
				))}
				<Button size="sm" variant="tertiary" isDisabled={disabled} onPress={onAddBack}>
					Back
				</Button>
				<Button size="sm" variant="tertiary" isDisabled={disabled} onPress={onAddHome}>
					Home
				</Button>
				<Button size="sm" variant="tertiary" isDisabled={disabled} onPress={onAddDismissKeyboard}>
					Dismiss keyboard
				</Button>
			</div>
		</div>
	);
}
