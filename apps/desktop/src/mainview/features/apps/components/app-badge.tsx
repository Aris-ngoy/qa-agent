import {
	APP_PLATFORM_LABELS,
	type AppPlatform,
	DEFAULT_APP_AVATAR_COLOR,
	appInitials,
} from "@/features/apps/utils/app-badge";
import type { ComponentType, SVGProps } from "react";

const AVATAR_SIZES = {
	sm: "size-6 text-[10px]",
	md: "size-7 text-[11px]",
} as const;

/** An app's initials on its own color (`appAvatarColors`), so apps are told apart at a glance. */
export function AppAvatar({
	name,
	colorClass = DEFAULT_APP_AVATAR_COLOR,
	size = "sm",
	title,
}: {
	name: string;
	colorClass?: string;
	size?: keyof typeof AVATAR_SIZES;
	title?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={[
				"flex shrink-0 items-center justify-center rounded-[var(--radius)] font-semibold text-on-avatar",
				AVATAR_SIZES[size],
				colorClass,
			].join(" ")}
			title={title}
		>
			{appInitials(name)}
		</span>
	);
}

function PlatformIcon(props: SVGProps<SVGSVGElement>) {
	return <svg aria-hidden="true" className="size-3.5 shrink-0" viewBox="0 0 24 24" {...props} />;
}

function WebIcon() {
	return (
		<PlatformIcon fill="none" stroke="currentColor" strokeWidth="1.75">
			<circle cx="12" cy="12" r="9" />
			<path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
		</PlatformIcon>
	);
}

function AndroidIcon() {
	return (
		<PlatformIcon
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.75"
		>
			<path d="M4 18a8 8 0 0 1 16 0z" />
			<path d="M7.5 8.5 5.5 5.5M16.5 8.5l2-3" />
			<circle cx="9" cy="14" fill="currentColor" r="0.9" stroke="none" />
			<circle cx="15" cy="14" fill="currentColor" r="0.9" stroke="none" />
		</PlatformIcon>
	);
}

function AppleIcon() {
	return (
		<PlatformIcon fill="currentColor">
			<path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.9-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.7zM14.1 5.5c.6-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.1 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4z" />
		</PlatformIcon>
	);
}

const PLATFORM_ICONS: Record<AppPlatform, ComponentType> = {
	web: WebIcon,
	android: AndroidIcon,
	ios: AppleIcon,
};

/** Small icons naming what an app runs on (`appPlatforms`); renders nothing for none. */
export function AppPlatformIcons({ platforms }: { platforms: readonly AppPlatform[] }) {
	if (platforms.length === 0) return null;
	const label = platforms.map((platform) => APP_PLATFORM_LABELS[platform]).join(", ");
	return (
		<span
			className="ml-auto flex shrink-0 items-center gap-1.5 text-on-surface-variant"
			title={label}
		>
			{platforms.map((platform) => {
				const Icon = PLATFORM_ICONS[platform];
				return <Icon key={platform} />;
			})}
			<span className="sr-only">{label}</span>
		</span>
	);
}
