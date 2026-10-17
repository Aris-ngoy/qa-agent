import { useReducedMotion } from "@/app/motion/use-reduced-motion";
import { ProvidersSection } from "@/features/providers/components/providers-section";
import { AndroidSettings } from "@/features/settings/components/android-settings";
import { AppearanceSettings } from "@/features/settings/components/appearance-settings";
import { CliSettings } from "@/features/settings/components/cli-settings";
import { DiagnosticsSettings } from "@/features/settings/components/diagnostics-settings";
import { IosSettings } from "@/features/settings/components/ios-settings";
import { SectionCard } from "@/features/settings/components/section-card";
import { Tabs } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import { useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";

type SettingsSection = "appearance" | "ios" | "android" | "cli" | "provider" | "diagnostics";

const SETTINGS_SECTIONS: SettingsSection[] = [
	"appearance",
	"ios",
	"android",
	"cli",
	"provider",
	"diagnostics",
];

const SECTIONS: { id: SettingsSection; label: string }[] = [
	{ id: "appearance", label: "Appearance" },
	{ id: "ios", label: "iOS" },
	{ id: "android", label: "Android" },
	{ id: "cli", label: "CLI & Agents" },
	{ id: "provider", label: "Provider" },
	{ id: "diagnostics", label: "Diagnostics" },
];

function isSettingsSection(value: string | undefined): value is SettingsSection {
	return value != null && SETTINGS_SECTIONS.includes(value as SettingsSection);
}

/** Remounts on tab change so `motion-fade-up` plays for each section. */
function SettingsSectionMotion({
	sectionId,
	active,
	children,
}: {
	sectionId: SettingsSection;
	active: boolean;
	children: ReactNode;
}) {
	const reduceMotion = useReducedMotion();
	if (!active) return null;
	return (
		<div className={reduceMotion ? undefined : "motion-fade-up"} key={sectionId}>
			{children}
		</div>
	);
}

export function SettingsPage() {
	const search = useSearch({ from: "/settings" });
	const initial = isSettingsSection(search.section) ? search.section : "appearance";
	const section$ = useObservable<SettingsSection>(initial);
	const section = useValue(section$);

	useEffect(() => {
		if (isSettingsSection(search.section)) {
			section$.set(search.section);
		}
	}, [search.section, section$]);

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-8">
			<Tabs
				className="flex w-full flex-col gap-6"
				onSelectionChange={(key) => section$.set(String(key) as SettingsSection)}
				selectedKey={section}
			>
				<SectionCard>
					<Tabs.ListContainer>
						<Tabs.List
							aria-label="Settings sections"
							className="relative w-fit max-w-full gap-1 rounded-xl bg-surface-container p-1"
						>
							{SECTIONS.map((item) => (
								<Tabs.Tab
									className="relative z-[1] h-auto min-h-9 rounded-lg px-3.5 py-1.5 text-body-sm font-medium text-on-surface-variant transition-[color,opacity] duration-[var(--motion-fast)] data-[selected=true]:font-semibold data-[selected=true]:!text-on-surface"
									id={item.id}
									key={item.id}
								>
									{item.label}
									<Tabs.Indicator className="-z-10 rounded-lg bg-surface-container-lowest shadow-card" />
								</Tabs.Tab>
							))}
						</Tabs.List>
					</Tabs.ListContainer>
				</SectionCard>

				<Tabs.Panel className="pt-0 outline-none" id="appearance">
					<SettingsSectionMotion active={section === "appearance"} sectionId="appearance">
						<AppearanceSettings />
					</SettingsSectionMotion>
				</Tabs.Panel>
				<Tabs.Panel className="pt-0 outline-none" id="ios">
					<SettingsSectionMotion active={section === "ios"} sectionId="ios">
						<IosSettings enabled={section === "ios"} />
					</SettingsSectionMotion>
				</Tabs.Panel>
				<Tabs.Panel className="pt-0 outline-none" id="android">
					<SettingsSectionMotion active={section === "android"} sectionId="android">
						<AndroidSettings enabled={section === "android"} />
					</SettingsSectionMotion>
				</Tabs.Panel>
				<Tabs.Panel className="pt-0 outline-none" id="cli">
					<SettingsSectionMotion active={section === "cli"} sectionId="cli">
						<CliSettings enabled={section === "cli"} />
					</SettingsSectionMotion>
				</Tabs.Panel>
				<Tabs.Panel className="pt-0 outline-none" id="provider">
					<SettingsSectionMotion active={section === "provider"} sectionId="provider">
						<ProvidersSection enabled={section === "provider"} />
					</SettingsSectionMotion>
				</Tabs.Panel>
				<Tabs.Panel className="pt-0 outline-none" id="diagnostics">
					<SettingsSectionMotion active={section === "diagnostics"} sectionId="diagnostics">
						<DiagnosticsSettings enabled={section === "diagnostics"} />
					</SettingsSectionMotion>
				</Tabs.Panel>
			</Tabs>
		</div>
	);
}
