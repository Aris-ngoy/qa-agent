import { useApps } from "@/features/apps/hooks/use-apps";
import {
	useOpenRemoteDebuggingSetting,
	useResetBrowserProfile,
} from "@/features/devices/hooks/usequery/use-devices";
import {
	type EverydayEntry,
	everydayStateLine,
	turnOnHint,
} from "@/features/devices/utils/everyday-browser";
import {
	resetProfileConfirmation,
	resetProfileDone,
	resetProfileRequest,
} from "@/features/devices/utils/web-device";
import { AlertDialog, Button, toast } from "@heroui/react";
import {
	type BrowserProfile,
	VIEWPORT_PRESETS,
	VIEWPORT_PRESET_NAMES,
	type ViewportPresetName,
} from "@yoqa/runner-client";

const PRESET_LABELS: Record<ViewportPresetName, string> = {
	desktop: "Desktop",
	mobile: "Mobile",
};

const PROFILE_OPTIONS: Array<{ name: BrowserProfile; label: string; detail: string }> = [
	{ name: "kept", label: "Kept", detail: "the App's logins" },
	{ name: "clean", label: "Clean", detail: "signed out" },
];

/** Two or more options side by side, one picked, each with a line of detail under it. */
function SegmentedChoice<T extends string>({
	legend,
	hint,
	options,
	value,
	onChange,
}: {
	legend: string;
	hint: string;
	options: ReadonlyArray<{ name: T; label: string; detail: string }>;
	value: T;
	onChange: (name: T) => void;
}) {
	return (
		<fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
			<legend className="mb-2 text-body-md font-semibold text-on-surface">{legend}</legend>
			<div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-container p-1">
				{options.map(({ name, label, detail }) => {
					const selected = name === value;
					return (
						<button
							aria-pressed={selected}
							className={[
								"flex flex-col items-center gap-0.5 rounded-lg px-3 py-2 text-body-sm font-medium transition-colors",
								selected
									? "bg-surface-container-lowest text-on-surface shadow-card"
									: "text-on-surface-variant hover:text-on-surface",
							].join(" ")}
							key={name}
							onClick={() => onChange(name)}
							type="button"
						>
							<span>{label}</span>
							<span className="text-helper text-on-surface-variant">{detail}</span>
						</button>
					);
				})}
			</div>
			<p className="m-0 text-helper text-on-surface-variant">{hint}</p>
		</fieldset>
	);
}

/** The Viewport preset a browser connects at, fixed for the Device Session's life. */
export function ViewportChoice({
	value,
	onChange,
	hint = "The page keeps this size for the whole session, so runs stay comparable.",
}: {
	value: ViewportPresetName;
	onChange: (preset: ViewportPresetName) => void;
	hint?: string;
}) {
	const options = VIEWPORT_PRESET_NAMES.map((name) => {
		const { width, height, mobile } = VIEWPORT_PRESETS[name];
		return {
			name,
			label: PRESET_LABELS[name],
			detail: `${width}×${height}${mobile ? " · touch" : ""}`,
		};
	});
	return (
		<SegmentedChoice
			hint={hint}
			legend="Viewport"
			onChange={onChange}
			options={options}
			value={value}
		/>
	);
}

/**
 * A web Run's browser profile: its App's Kept one or a clean one. A case asking for
 * `profile: clean` still runs clean on Kept, as `yoqa runs create` does without `--profile`.
 */
export function ProfileChoice({
	value,
	onChange,
}: {
	value: BrowserProfile;
	onChange: (profile: BrowserProfile) => void;
}) {
	return (
		<SegmentedChoice
			hint="Clean runs on a throwaway profile. On Kept, a case that asks for profile: clean still runs clean."
			legend="Profile"
			onChange={onChange}
			options={PROFILE_OPTIONS}
			value={value}
		/>
	);
}

/**
 * The user's own browsers, by consent (ADR-0009): a ready one is picked to connect; one with
 * remote debugging off offers "Open the setting", which opens the toggle in that browser.
 */
export function EverydayBrowserList({
	browsers,
	loading,
	error,
	onSelect,
}: {
	browsers: EverydayEntry[];
	loading: boolean;
	error: string | null;
	onSelect: (browser: EverydayEntry) => void;
}) {
	const openSetting = useOpenRemoteDebuggingSetting();

	if (loading && browsers.length === 0) {
		return (
			<p className="px-1 py-6 text-center text-body-md text-on-surface-variant">
				Looking for browsers…
			</p>
		);
	}
	if (error) {
		return <p className="px-1 py-6 text-center text-body-md text-danger">{error}</p>;
	}
	if (browsers.length === 0) {
		return (
			<p className="px-1 py-6 text-center text-body-md text-on-surface-variant">
				No Chrome, Edge, Brave, Chromium, Dia, Arc, Opera or Vivaldi found in Applications.
			</p>
		);
	}

	return (
		<ul className="divide-y divide-outline-variant/60">
			{browsers.map((browser) => (
				<li className="flex items-center gap-2" key={browser.id}>
					<button
						className="flex min-w-0 flex-1 items-center justify-between gap-4 px-1 py-3.5 text-left transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:hover:bg-transparent"
						disabled={!browser.ready}
						onClick={() => onSelect(browser)}
						type="button"
					>
						<span className="min-w-0 text-body-md font-semibold text-on-surface">
							{browser.browserName}
							{browser.ready ? null : (
								<span className="block text-body-sm font-normal text-on-surface-variant">
									{turnOnHint(browser)}
								</span>
							)}
						</span>
						<span
							className={[
								"shrink-0 text-helper capitalize",
								browser.ready ? "text-success" : "text-on-surface-variant/80",
							].join(" ")}
						>
							{everydayStateLine(browser)}
						</span>
					</button>
					{browser.ready ? null : (
						<Button
							className="shrink-0 rounded-lg text-body-sm"
							isDisabled={openSetting.isPending}
							onPress={() => openSetting.mutate(browser.id)}
							size="sm"
							variant="tertiary"
						>
							Open the setting
						</Button>
					)}
				</li>
			))}
		</ul>
	);
}

/** An installed browser whose Kept profile "Reset browser profile" deletes. */
export type ResetProfileTarget = { id: string; name: string };

/**
 * Confirm, then delete `browser`'s Kept profile for the selected app. The runner refuses
 * while that browser has the profile open; its reason stays in the dialog until closed.
 */
export function ResetProfileDialog({
	browser,
	onClose,
}: {
	browser: ResetProfileTarget | null;
	onClose: () => void;
}) {
	const { selectedApp } = useApps();
	const resetMutation = useResetBrowserProfile();
	const { reset: clearResult } = resetMutation;

	const close = () => {
		clearResult();
		onClose();
	};

	const handleReset = () => {
		if (!browser) return;
		resetMutation.mutate(resetProfileRequest(browser.id, selectedApp), {
			onSuccess: (result) => {
				toast.success(resetProfileDone(browser.name, selectedApp, result));
				close();
			},
		});
	};

	let refusal: string | null = null;
	if (resetMutation.error) {
		refusal =
			resetMutation.error instanceof Error
				? resetMutation.error.message
				: "Failed to reset the browser profile";
	}

	return (
		<AlertDialog>
			<AlertDialog.Backdrop isOpen={browser != null} onOpenChange={(open) => !open && close()}>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>Reset browser profile?</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body className="flex flex-col gap-3">
							<p>{browser ? resetProfileConfirmation(browser.name, selectedApp) : null}</p>
							{refusal ? (
								<p className="m-0 text-body-sm text-danger" role="alert">
									{refusal}
								</p>
							) : null}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button slot="close" variant="tertiary">
								Cancel
							</Button>
							<Button isDisabled={resetMutation.isPending} onPress={handleReset} variant="danger">
								{resetMutation.isPending ? "Resetting…" : "Reset"}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</AlertDialog>
	);
}
