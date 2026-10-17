import type { XcodeInstallation } from "@/../shared/ios-toolchain";
import { XcodeMark } from "@/features/settings/components/brand-marks";
import { IosSigningCard } from "@/features/settings/components/ios-signing-card";
import { SectionCard } from "@/features/settings/components/section-card";
import {
	useIosToolchain,
	useSetIosToolchain,
} from "@/features/settings/hooks/usequery/use-toolchains";
import { ListBox, Select } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import { useEffect } from "react";

function xcodeLabel(item: XcodeInstallation): string {
	return `${item.appName} ${item.version}`;
}

export function IosSettings({ enabled }: { enabled: boolean }) {
	const xcodeId$ = useObservable<string | null>(null);
	const xcodeId = useValue(xcodeId$);
	const toolchainQuery = useIosToolchain(enabled);
	const setToolchain = useSetIosToolchain();

	useEffect(() => {
		if (!toolchainQuery.data) return;
		xcodeId$.set(toolchainQuery.data.preferences.xcodeDeveloperDir);
	}, [toolchainQuery.data, xcodeId$]);

	const xcodes = toolchainQuery.data?.xcodes ?? [];
	const selectedXcode = xcodes.find((item) => item.id === xcodeId) ?? null;

	const handleXcodeChange = (key: string | null) => {
		if (key == null) return;
		xcodeId$.set(key);
		setToolchain.mutate({ xcodeDeveloperDir: key });
	};

	return (
		<div className="flex flex-col gap-6">
			<p className="text-body-md text-on-surface-variant">Settings for running local iOS tests.</p>

			<SectionCard>
				<h3 className="text-subheading font-semibold text-on-surface">Xcode</h3>
				<p className="mt-1 mb-3 text-body-md text-on-surface-variant">
					Toolchain used to build and run iOS tests. Auto-detected; change to use a different
					installed Xcode.
				</p>
				{toolchainQuery.isLoading ? (
					<p className="text-body-md text-on-surface-variant">Scanning installed Xcode…</p>
				) : toolchainQuery.isError ? (
					<p className="text-body-md text-error">
						Could not scan Xcode installations. Open Settings again after Xcode is installed.
					</p>
				) : xcodes.length === 0 ? (
					<p className="text-body-md text-on-surface-variant">
						No Xcode apps found in /Applications. Install Xcode from the App Store.
					</p>
				) : (
					<Select
						aria-label="Xcode"
						selectedKey={xcodeId}
						onSelectionChange={(key) => handleXcodeChange(key == null ? null : String(key))}
					>
						<Select.Trigger className="h-12 w-full items-center gap-3 rounded-xl border border-outline-variant bg-surface-container px-3.5 shadow-none">
							<Select.Value>
								{({ isPlaceholder }) =>
									isPlaceholder || !selectedXcode ? (
										"Select Xcode"
									) : (
										<span className="flex min-w-0 items-center gap-2.5">
											<XcodeMark />
											<span className="truncate text-body-md text-on-surface">
												<span className="font-medium">{xcodeLabel(selectedXcode)}</span>{" "}
												<span className="text-on-surface-variant">
													{selectedXcode.developerDir}
												</span>
											</span>
										</span>
									)
								}
							</Select.Value>
							<Select.Indicator className="text-on-surface-variant" />
						</Select.Trigger>
						<Select.Popover>
							<ListBox>
								{xcodes.map((item) => (
									<ListBox.Item
										id={item.id}
										key={item.id}
										textValue={`${xcodeLabel(item)} ${item.developerDir}`}
									>
										<span className="flex min-w-0 items-center gap-2.5">
											<XcodeMark />
											<span className="truncate">
												<span className="font-medium">{xcodeLabel(item)}</span>{" "}
												<span className="text-on-surface-variant">{item.developerDir}</span>
											</span>
										</span>
										<ListBox.ItemIndicator />
									</ListBox.Item>
								))}
							</ListBox>
						</Select.Popover>
					</Select>
				)}
			</SectionCard>

			<SectionCard>
				<IosSigningCard enabled={enabled} />
			</SectionCard>
		</div>
	);
}
