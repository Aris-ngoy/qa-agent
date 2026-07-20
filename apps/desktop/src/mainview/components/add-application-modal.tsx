import { Button, Modal, SearchField } from "@heroui/react";
import { useEffect, useState } from "react";

const SUGGESTIONS = [
	"PlayZone: Get Paid Real Money",
	"FIFA Official App",
	"Bally's GameZone",
	"PlayZone Arcade Hub",
	"PlayZone Pro",
] as const;

type AddApplicationModalProps = {
	open: boolean;
	onClose: () => void;
	onAdd: (name: string) => void;
};

export function AddApplicationModal({ open, onClose, onAdd }: AddApplicationModalProps) {
	const [query, setQuery] = useState("");

	useEffect(() => {
		if (open) {
			setQuery("");
		}
	}, [open]);

	const trimmed = query.trim();
	const matches = trimmed
		? SUGGESTIONS.filter((name) => name.toLowerCase().includes(trimmed.toLowerCase()))
		: [...SUGGESTIONS];
	const exactMatch = matches.some((name) => name.toLowerCase() === trimmed.toLowerCase());
	const showCreate = Boolean(trimmed) && !exactMatch;

	const submit = (name: string) => {
		onAdd(name);
		onClose();
	};

	return (
		<Modal>
			<Modal.Backdrop isOpen={open} onOpenChange={(next) => !next && onClose()} variant="opaque">
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog className="max-h-[min(32rem,90vh)] sm:max-w-2xl">
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading className="text-headline-md text-on-surface">
								Add Application
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="gap-0 p-0">
							<div className="px-6 pb-4">
								<SearchField
									aria-label="Search or enter app name"
									fullWidth
									name="app-name"
									onChange={setQuery}
									onKeyDown={(event) => {
										if (event.key === "Enter" && trimmed) {
											event.preventDefault();
											submit(trimmed);
										}
									}}
									value={query}
									variant="secondary"
								>
									<SearchField.Group>
										<SearchField.SearchIcon />
										<SearchField.Input autoFocus placeholder="Search or enter app name" />
										<SearchField.ClearButton />
									</SearchField.Group>
								</SearchField>
							</div>

							<div className="min-h-0 flex-1 overflow-y-auto border-t border-outline-variant">
								{showCreate ? (
									<Button
										className="h-auto w-full justify-start gap-3 rounded-none px-6 py-3"
										onPress={() => submit(trimmed)}
										variant="ghost"
									>
										<span className="flex size-8 items-center justify-center rounded bg-surface-container text-on-surface-variant">
											<svg
												aria-hidden="true"
												className="size-5"
												fill="none"
												stroke="currentColor"
												strokeWidth="1.75"
												viewBox="0 0 24 24"
											>
												<path d="M12 4v16m8-8H4" strokeLinecap="round" />
											</svg>
										</span>
										<span className="text-body-md font-medium text-on-surface">
											Create an app &ldquo;{trimmed}&rdquo;
										</span>
									</Button>
								) : null}

								{matches.map((name) => (
									<Button
										key={name}
										className="h-auto w-full justify-start gap-3 rounded-none border-t border-outline-variant/60 px-6 py-3"
										onPress={() => submit(name)}
										variant="ghost"
									>
										<span
											aria-hidden="true"
											className="flex size-8 shrink-0 items-center justify-center rounded bg-primary text-helper font-semibold text-on-primary"
										>
											{name.slice(0, 1)}
										</span>
										<span className="text-body-md font-medium text-on-surface">{name}</span>
									</Button>
								))}
							</div>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
