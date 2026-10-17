import type { AndroidPathSource } from "@/../shared/android-toolchain";
import { SectionCard } from "@/features/settings/components/section-card";
import {
	useAndroidToolchain,
	useSaveAndroidToolchain,
} from "@/features/settings/hooks/usequery/use-toolchains";
import { androidPathSourceLabel, draftPathOverride } from "@/features/settings/utils/android-paths";
import { Button, Description, FieldError, Input, TextField } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import { useEffect } from "react";

function AndroidPathField({
	kind,
	label,
	description,
	value,
	placeholder,
	detectedPath,
	detectedSource,
	exists,
	overridden,
	onChange,
	onReset,
}: {
	kind: "sdk" | "java";
	label: string;
	description: string;
	value: string;
	placeholder: string;
	detectedPath: string | null;
	detectedSource: AndroidPathSource;
	exists: boolean;
	overridden: boolean;
	onChange: (next: string) => void;
	onReset: () => void;
}) {
	const savedMissing = value.trim().length > 0 && !exists;

	return (
		<SectionCard>
			<h3 className="text-subheading font-semibold text-on-surface">{label}</h3>
			<p className="mt-1 mb-3 text-body-md text-on-surface-variant">{description}</p>
			<TextField
				aria-label={label}
				className="w-full"
				isInvalid={savedMissing}
				onChange={onChange}
				value={value}
			>
				<Input
					className="h-12 w-full rounded-xl border border-outline-variant bg-surface-container px-3.5 font-mono text-body-sm shadow-none"
					placeholder={placeholder}
				/>
				{savedMissing ? (
					<FieldError>This folder was not found on disk.</FieldError>
				) : (
					<Description className="mt-1.5 text-helper text-on-surface-variant">
						System default: {detectedPath ?? "not found"} (
						{androidPathSourceLabel(kind, detectedSource)})
						{overridden ? " · using a custom path" : ""}
					</Description>
				)}
			</TextField>
			{overridden ? (
				<div className="mt-3">
					<Button onPress={onReset} size="sm" variant="tertiary">
						Use system default
					</Button>
				</div>
			) : null}
		</SectionCard>
	);
}

export function AndroidSettings({ enabled }: { enabled: boolean }) {
	const draft$ = useObservable({ sdkRoot: "", javaHome: "", saveError: null as string | null });
	const sdkRoot = useValue(draft$.sdkRoot);
	const javaHome = useValue(draft$.javaHome);
	const saveError = useValue(draft$.saveError);
	const toolchainQuery = useAndroidToolchain(enabled);

	useEffect(() => {
		if (!toolchainQuery.data) return;
		draft$.set({
			sdkRoot: toolchainQuery.data.effective.sdkRoot ?? "",
			javaHome: toolchainQuery.data.effective.javaHome ?? "",
			saveError: null,
		});
	}, [toolchainQuery.data, draft$]);

	const snapshot = toolchainQuery.data;
	const sdkOverrideDraft = draftPathOverride(sdkRoot, snapshot?.detected.sdkRoot.path ?? null);
	const javaOverrideDraft = draftPathOverride(javaHome, snapshot?.detected.javaHome.path ?? null);
	const dirty =
		snapshot != null &&
		(sdkOverrideDraft !== snapshot.preferences.sdkRoot ||
			javaOverrideDraft !== snapshot.preferences.javaHome);

	const saveMutation = useSaveAndroidToolchain({
		onSuccess: () => draft$.saveError.set(null),
		onError: (error) =>
			draft$.saveError.set(error instanceof Error ? error.message : String(error)),
	});

	return (
		<div className="flex flex-col gap-6">
			<p className="text-body-md text-on-surface-variant">
				Paths the Android Direct lane uses for local Android tests. Detected from your system;
				override only if you need a different SDK or JDK.
			</p>

			{toolchainQuery.isLoading ? (
				<p className="text-body-md text-on-surface-variant">Detecting Android toolchain…</p>
			) : toolchainQuery.isError ? (
				<p className="text-body-md text-error">Could not detect Android SDK or Java paths.</p>
			) : snapshot ? (
				<>
					<AndroidPathField
						kind="sdk"
						detectedPath={snapshot.detected.sdkRoot.path}
						detectedSource={snapshot.detected.sdkRoot.source}
						description="Folder that contains platform-tools and emulator. Used as ANDROID_HOME and ANDROID_SDK_ROOT."
						exists={
							sdkRoot.trim() === (snapshot.effective.sdkRoot ?? "")
								? snapshot.effective.sdkRootExists
								: true
						}
						label="Android SDK"
						onChange={(next) => draft$.sdkRoot.set(next)}
						onReset={() => draft$.sdkRoot.set(snapshot.detected.sdkRoot.path ?? "")}
						overridden={sdkOverrideDraft != null}
						placeholder={snapshot.detected.sdkRoot.path ?? "~/Library/Android/sdk"}
						value={sdkRoot}
					/>
					<AndroidPathField
						kind="java"
						detectedPath={snapshot.detected.javaHome.path}
						detectedSource={snapshot.detected.javaHome.source}
						description="JDK used to build and run UiAutomator2. Android Studio's bundled JBR is used when JAVA_HOME is unset."
						exists={
							javaHome.trim() === (snapshot.effective.javaHome ?? "")
								? snapshot.effective.javaHomeExists
								: true
						}
						label="JAVA_HOME"
						onChange={(next) => draft$.javaHome.set(next)}
						onReset={() => draft$.javaHome.set(snapshot.detected.javaHome.path ?? "")}
						overridden={javaOverrideDraft != null}
						placeholder={snapshot.detected.javaHome.path ?? "/Library/Java/JavaVirtualMachines"}
						value={javaHome}
					/>
				</>
			) : null}

			<div className="flex flex-wrap items-center gap-3">
				<Button
					isDisabled={!enabled || !dirty || saveMutation.isPending || toolchainQuery.isLoading}
					onPress={() => saveMutation.mutate({ sdkRoot, javaHome })}
					variant="primary"
				>
					{saveMutation.isPending ? "Saving…" : "Save and restart runner"}
				</Button>
				{dirty ? (
					<p className="text-body-sm text-on-surface-variant">
						Saving restarts the local runner so the Direct lane picks up the new paths.
					</p>
				) : null}
			</div>
			{saveError ? <p className="text-body-sm text-error">{saveError}</p> : null}
		</div>
	);
}
