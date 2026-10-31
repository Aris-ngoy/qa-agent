import type { Application } from "@/features/apps/data/api/apps";
import type { TreePanel } from "@/features/inspector/utils/tree-source";
import { ListBox, Select, Switch } from "@heroui/react";

type TreeSourceBarProps = {
	panel: TreePanel;
	/** The apps the session's platform can target, for the "No target app" selector. */
	apps: Application[];
	disabled: boolean;
	onShowSystemChange: (show: boolean) => void;
	onChooseApp: (appId: string) => void;
};

/**
 * Where the Device panel's tree came from. With SpringBoard read and no target app, it says
 * so and offers the app selector; a toggle shows SpringBoard's elements instead. Renders
 * nothing on a Lane that does not say where its tree came from.
 */
export function TreeSourceBar({
	panel,
	apps,
	disabled,
	onShowSystemChange,
	onChooseApp,
}: TreeSourceBarProps) {
	if (panel.label == null) return null;
	const systemToggle = panel.kind !== "tree";

	return (
		<div className="-mt-1 flex flex-col gap-2.5">
			<div className="flex items-center justify-between gap-2">
				<p
					className="m-0 truncate font-mono text-helper text-on-surface-variant"
					title={panel.label}
				>
					{panel.label}
				</p>
				{systemToggle ? (
					<Switch
						size="sm"
						isSelected={panel.kind === "system"}
						onChange={onShowSystemChange}
						aria-label="Show SpringBoard elements"
					>
						<Switch.Content className="flex items-center gap-2 text-helper text-on-surface-variant">
							Show SpringBoard elements
							<Switch.Control>
								<Switch.Thumb />
							</Switch.Control>
						</Switch.Content>
					</Switch>
				) : null}
			</div>

			{panel.kind === "no-target-app" ? (
				<div className="flex flex-col gap-2 rounded-xl bg-surface-container p-3">
					<p className="m-0 text-body-sm font-semibold text-on-surface">No target app</p>
					<p className="m-0 text-helper text-on-surface-variant">
						The device session has no target app, so this tree is SpringBoard's (the home screen or
						app switcher). Pick the app to inspect.
					</p>
					{apps.length > 0 ? (
						<Select
							aria-label="Target app"
							placeholder="Choose an app…"
							selectedKey={null}
							isDisabled={disabled}
							onSelectionChange={(key) => {
								if (key != null) onChooseApp(String(key));
							}}
						>
							<Select.Trigger className="h-10 w-full items-center rounded-xl border border-outline-variant bg-surface-bright px-3 shadow-none">
								<Select.Value />
								<Select.Indicator className="text-on-surface-variant" />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									{apps.map((app) => (
										<ListBox.Item id={app.id} key={app.id} textValue={app.name}>
											{app.name}
											<ListBox.ItemIndicator />
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
						</Select>
					) : (
						<p className="m-0 text-helper text-on-surface-variant">
							No app has an id for this device yet. Add one in Configuration.
						</p>
					)}
				</div>
			) : null}
		</div>
	);
}
