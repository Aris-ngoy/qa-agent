import { Button, Input, Label, TextField } from "@heroui/react";
import { useState } from "react";
import type { InspectorSelection } from "./selection";

type CommandBarProps = {
	selection: InspectorSelection | null;
	disabled: boolean;
	onAddTap: () => void;
	onAddInput: (text: string) => void;
	onAddSwipe: (direction: "up" | "down" | "left" | "right") => void;
	onAddWait: (seconds: number) => void;
	onClearSelection: () => void;
};

export function CommandBar({
	selection,
	disabled,
	onAddTap,
	onAddInput,
	onAddSwipe,
	onAddWait,
	onClearSelection,
}: CommandBarProps) {
	const [inputText, setInputText] = useState("");
	const [waitSeconds, setWaitSeconds] = useState("1");
	const hasSelection = selection != null;

	return (
		<div className="flex flex-col gap-2 border-b border-outline-variant/30 pb-3">
			<div className="flex flex-wrap items-center gap-1.5">
				<Button
					size="sm"
					variant="primary"
					isDisabled={disabled || !hasSelection}
					onPress={() => {
						onAddTap();
					}}
				>
					Add tap
				</Button>
				<Button
					size="sm"
					variant="secondary"
					isDisabled={disabled}
					onPress={() => {
						onAddSwipe("up");
					}}
				>
					Swipe up
				</Button>
				<Button
					size="sm"
					variant="secondary"
					isDisabled={disabled}
					onPress={() => {
						onAddSwipe("down");
					}}
				>
					Swipe down
				</Button>
				<Button
					size="sm"
					variant="secondary"
					isDisabled={disabled}
					onPress={() => {
						onAddSwipe("left");
					}}
				>
					Swipe left
				</Button>
				<Button
					size="sm"
					variant="secondary"
					isDisabled={disabled}
					onPress={() => {
						onAddSwipe("right");
					}}
				>
					Swipe right
				</Button>
				<Button
					size="sm"
					variant="tertiary"
					isDisabled={disabled || !hasSelection}
					onPress={() => {
						onClearSelection();
					}}
				>
					Clear selection
				</Button>
			</div>

			<div className="flex flex-wrap items-end gap-2">
				<TextField className="min-w-40 flex-1" value={inputText} onChange={setInputText}>
					<Label className="mb-1 text-helper text-on-surface-variant">Input text</Label>
					<Input placeholder="Type into focused field…" />
				</TextField>
				<Button
					size="sm"
					variant="secondary"
					isDisabled={disabled || inputText.trim().length === 0}
					onPress={() => {
						onAddInput(inputText);
						setInputText("");
					}}
				>
					Add input
				</Button>

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
