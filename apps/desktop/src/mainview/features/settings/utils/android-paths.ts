import type { AndroidPathSource } from "@/../shared/android-toolchain";

export function androidPathSourceLabel(kind: "sdk" | "java", source: AndroidPathSource): string {
	if (source === "env") return kind === "sdk" ? "from ANDROID_HOME" : "from JAVA_HOME";
	if (source === "android-studio") return "Android Studio JBR";
	if (source === "platform-default") return "Android Studio default";
	if (source === "java_home") return "from /usr/libexec/java_home";
	return "not detected";
}

/** The override a path draft saves: none when empty or the same as the detected path. */
export function draftPathOverride(draft: string, detected: string | null): string | null {
	const trimmed = draft.trim();
	if (!trimmed) return null;
	if (detected && trimmed === detected) return null;
	return trimmed;
}
