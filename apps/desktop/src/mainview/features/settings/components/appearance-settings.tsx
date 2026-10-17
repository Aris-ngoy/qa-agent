import { SectionCard } from "@/features/settings/components/section-card";
import { useThemeMode } from "@/features/settings/hooks/use-theme-mode";
import type { ThemeMode } from "@/features/settings/utils/ui-preferences";
import { Description, Tabs } from "@heroui/react";

const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
	{ id: "light", label: "Light" },
	{ id: "dark", label: "Dark" },
	{ id: "system", label: "System" },
];

export function AppearanceSettings() {
	const [mode, setMode] = useThemeMode();
	return (
		<SectionCard>
			<h2 className="text-subheading text-on-surface">Theme</h2>
			<Description className="mt-1">
				Choose a theme, or follow your operating system's appearance.
			</Description>
			<Tabs
				className="mt-4"
				onSelectionChange={(key) => setMode(String(key) as ThemeMode)}
				selectedKey={mode}
			>
				<Tabs.ListContainer>
					<Tabs.List
						aria-label="Theme"
						className="relative w-fit gap-1 rounded-xl bg-surface-container p-1"
					>
						{THEME_OPTIONS.map((item) => (
							<Tabs.Tab
								className="relative z-[1] h-auto min-h-9 rounded-lg px-3.5 py-1.5 text-body-sm font-medium text-on-surface-variant data-[selected=true]:font-semibold data-[selected=true]:!text-on-surface"
								id={item.id}
								key={item.id}
							>
								{item.label}
								<Tabs.Indicator className="-z-10 rounded-lg bg-surface-container-lowest shadow-card" />
							</Tabs.Tab>
						))}
					</Tabs.List>
				</Tabs.ListContainer>
			</Tabs>
		</SectionCard>
	);
}
