import { Button, Dropdown, Label, Separator } from "@heroui/react";
import { type SVGProps, useState } from "react";
import { useApps } from "../apps-context";
import { AddApplicationModal } from "./add-application-modal";

function ChevronUpDown(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-4"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<path d="M7 15l5 5 5-5M7 9l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function ChevronDown(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-4 shrink-0"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function AppStackIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-5 shrink-0 text-primary"
			fill="currentColor"
			viewBox="0 0 24 24"
			{...props}
		>
			<path d="M7 4h10a1 1 0 011 1v12a1 1 0 01-1 1H7a1 1 0 01-1-1V5a1 1 0 011-1zm1 2v10h8V6H8z" />
			<path d="M5 8h1v10a1 1 0 001 1h10v1a1 1 0 01-1 1H6a1 1 0 01-1-1V8z" opacity="0.55" />
			<path d="M3 11h1v8a1 1 0 001 1h10v1a1 1 0 01-1 1H4a1 1 0 01-1-1v-9z" opacity="0.3" />
		</svg>
	);
}

function PhoneIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-4 shrink-0 text-on-surface-variant"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<rect height="16" rx="2" width="10" x="7" y="4" />
			<path d="M11 17h2" strokeLinecap="round" />
		</svg>
	);
}

const ADD_APP_KEY = "add-application";

export function WorkspaceHeader() {
	const { apps, selectedApp, selectApp, addApp } = useApps();
	const [modalOpen, setModalOpen] = useState(false);

	const appLabel = selectedApp?.name ?? "Select app";

	return (
		<>
			<header className="sticky top-0 z-50 flex h-14 w-full shrink-0 items-stretch border-b border-outline-variant bg-surface-container-lowest">
				<div className="relative flex w-sidebar shrink-0 items-center border-r border-outline-variant bg-surface-container-low px-4">
					<Dropdown>
						<Button
							className="w-full justify-start gap-2 px-1 text-left text-subheading text-primary"
							variant="ghost"
						>
							<AppStackIcon />
							<span className="min-w-0 flex-1 truncate">{appLabel}</span>
							<span className="text-on-surface-variant">
								<ChevronUpDown />
							</span>
						</Button>
						<Dropdown.Popover className="w-64">
							<Dropdown.Menu
								onAction={(key) => {
									if (String(key) === ADD_APP_KEY) {
										setModalOpen(true);
										return;
									}
									selectApp(String(key));
								}}
								selectedKeys={selectedApp ? new Set([selectedApp.id]) : new Set()}
								selectionMode="single"
							>
								{apps.length > 0 ? (
									apps.map((app) => (
										<Dropdown.Item id={app.id} key={app.id} textValue={app.name}>
											<span
												aria-hidden="true"
												className="flex size-6 shrink-0 items-center justify-center rounded bg-primary text-helper font-semibold text-on-primary"
											>
												{app.name.slice(0, 1)}
											</span>
											<Label>{app.name}</Label>
										</Dropdown.Item>
									))
								) : (
									<Dropdown.Item id="empty" isDisabled textValue="No applications yet">
										<Label className="text-on-surface-variant">No applications yet.</Label>
									</Dropdown.Item>
								)}
								<Separator />
								<Dropdown.Item id={ADD_APP_KEY} textValue="Add application">
									<svg
										aria-hidden="true"
										className="size-4 text-primary"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.75"
										viewBox="0 0 24 24"
									>
										<path d="M12 5v14M5 12h14" strokeLinecap="round" />
									</svg>
									<Label className="font-medium text-primary">Add application</Label>
								</Dropdown.Item>
							</Dropdown.Menu>
						</Dropdown.Popover>
					</Dropdown>
				</div>

				<div className="flex min-w-0 flex-1 items-center justify-end gap-6 px-6">
					{selectedApp ? (
						<>
							<div className="mr-auto hidden min-w-0 sm:block">
								<p className="text-label-caps uppercase tracking-widest text-on-surface-variant">
									Test Cases
								</p>
								<p className="truncate text-body-md font-semibold text-on-surface">
									No tests selected
								</p>
							</div>

							<Button
								className="hidden h-9 min-w-[10.5rem] justify-between md:inline-flex"
								variant="outline"
							>
								<PhoneIcon />
								<span className="flex-1 text-left">Select device</span>
								<ChevronDown />
							</Button>

							<Button
								className="hidden h-9 min-w-[9.5rem] justify-between md:inline-flex"
								variant="outline"
							>
								<span className="flex-1 text-left">Select build</span>
								<ChevronDown />
							</Button>

							<Button className="bg-secondary text-on-secondary data-[hovered=true]:bg-secondary/90">
								<svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 24 24">
									<path d="M8 5.5v13l11-6.5L8 5.5Z" />
								</svg>
								Run
							</Button>
						</>
					) : null}
				</div>
			</header>

			<AddApplicationModal
				onAdd={(name) => {
					addApp(name);
				}}
				onClose={() => setModalOpen(false)}
				open={modalOpen}
			/>
		</>
	);
}
