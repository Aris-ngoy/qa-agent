import type { DevicePlatform } from "@/features/devices/select-device-modal";
import { Button, Input, Label, TextField } from "@heroui/react";
import { useEffect, useState } from "react";

const NOTES_BUNDLE_ID = "com.apple.mobilenotes";

type CommandBarProps = {
	disabled: boolean;
	platform: DevicePlatform;
	/** Prefill for App ID (selected app's iOS bundle id / Android package). */
	defaultAppId: string;
	onAddSwipe: (direction: "up" | "down" | "left" | "right") => void;
	onAddWait: (seconds: number) => void;
	onAddAppAction: (kind: "activate-app" | "terminate-app" | "restart-app", appId: string) => void;
	onAddOpenUrl: (url: string) => void;
	onAddAlert: (alertAction: "accept" | "dismiss") => void;
};

/** Global (non-element) script helpers — swipe, wait, app lifecycle, open-url, alerts. */
export function CommandBar({
	disabled,
	platform,
	defaultAppId,
	onAddSwipe,
	onAddWait,
	onAddAppAction,
	onAddOpenUrl,
	onAddAlert,
}: CommandBarProps) {
	const [waitSeconds, setWaitSeconds] = useState("1");
	const [appId, setAppId] = useState(defaultAppId);
	const [url, setUrl] = useState("");

	useEffect(() => {
		setAppId(defaultAppId);
	}, [defaultAppId]);

	const trimmedAppId = appId.trim();
	const trimmedUrl = url.trim();
	const canAppAction = trimmedAppId.length > 0;
	const canOpenUrl = trimmedUrl.length > 0;

	return (
		<div className="flex flex-col gap-3 rounded-xl border border-outline-variant/30 bg-surface-container/40 px-3 py-2.5">
			<div className="flex flex-col gap-2">
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

			<div className="flex flex-col gap-2 border-t border-outline-variant/25 pt-2.5">
				<p className="text-helper text-on-surface-variant">
					App control — activate Notes, open a deeplink URL, or accept system alerts.
				</p>
				<div className="flex flex-wrap items-end gap-2">
					<TextField className="min-w-48 flex-1" value={appId} onChange={setAppId}>
						<Label className="mb-1 text-helper text-on-surface-variant">App ID</Label>
						<Input placeholder={platform === "ios" ? "com.example.app" : "com.example.app"} />
					</TextField>
					<Button
						size="sm"
						variant="secondary"
						isDisabled={disabled || !canAppAction}
						onPress={() => {
							onAddAppAction("activate-app", trimmedAppId);
						}}
					>
						Activate
					</Button>
					<Button
						size="sm"
						variant="secondary"
						isDisabled={disabled || !canAppAction}
						onPress={() => {
							onAddAppAction("terminate-app", trimmedAppId);
						}}
					>
						Terminate
					</Button>
					<Button
						size="sm"
						variant="secondary"
						isDisabled={disabled || !canAppAction}
						onPress={() => {
							onAddAppAction("restart-app", trimmedAppId);
						}}
					>
						Restart
					</Button>
					{platform === "ios" ? (
						<Button
							size="sm"
							variant="secondary"
							isDisabled={disabled}
							onPress={() => {
								onAddAppAction("activate-app", NOTES_BUNDLE_ID);
							}}
						>
							Open Notes
						</Button>
					) : null}
				</div>
				<div className="flex flex-wrap items-end gap-2">
					<TextField className="min-w-56 flex-1" value={url} onChange={setUrl}>
						<Label className="mb-1 text-helper text-on-surface-variant">URL</Label>
						<Input placeholder="myapp://path or https://…" />
					</TextField>
					<Button
						size="sm"
						variant="secondary"
						isDisabled={disabled || !canOpenUrl}
						onPress={() => {
							onAddOpenUrl(trimmedUrl);
						}}
					>
						Open URL
					</Button>
					<Button
						size="sm"
						variant="secondary"
						isDisabled={disabled}
						onPress={() => {
							onAddAlert("accept");
						}}
					>
						Accept alert
					</Button>
					<Button
						size="sm"
						variant="secondary"
						isDisabled={disabled}
						onPress={() => {
							onAddAlert("dismiss");
						}}
					>
						Dismiss alert
					</Button>
				</div>
			</div>
		</div>
	);
}
