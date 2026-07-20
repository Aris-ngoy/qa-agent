import { useEffect, useId, useRef, useState } from "react";

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
	const titleId = useId();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) {
			return;
		}
		if (open) {
			if (!dialog.open) {
				dialog.showModal();
			}
			setQuery("");
			const frame = requestAnimationFrame(() => inputRef.current?.focus());
			return () => cancelAnimationFrame(frame);
		}
		if (dialog.open) {
			dialog.close();
		}
		return;
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
		<dialog
			ref={dialogRef}
			aria-labelledby={titleId}
			className="fixed inset-0 z-[100] m-0 h-full max-h-none w-full max-w-none items-center justify-center bg-primary/40 p-4 open:flex backdrop:bg-transparent"
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
		>
			<div className="flex max-h-[min(32rem,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
				<div className="flex items-center justify-between px-6 pb-4 pt-6">
					<h2 className="text-headline-md text-on-surface" id={titleId}>
						Add Application
					</h2>
					<button
						aria-label="Close"
						className="rounded p-1 text-on-surface-variant transition-colors hover:bg-hover-surface hover:text-on-surface"
						onClick={onClose}
						type="button"
					>
						<svg
							aria-hidden="true"
							className="size-6"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.75"
							viewBox="0 0 24 24"
						>
							<path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" />
						</svg>
					</button>
				</div>

				<div className="px-6 pb-4">
					<label className="relative block">
						<span className="sr-only">Search or enter app name</span>
						<span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant">
							<svg
								aria-hidden="true"
								className="size-5"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.75"
								viewBox="0 0 24 24"
							>
								<path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" />
							</svg>
						</span>
						<input
							ref={inputRef}
							className="block w-full rounded border border-outline-variant bg-surface-container-lowest py-3 pl-10 pr-3 text-body-md text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && trimmed) {
									event.preventDefault();
									submit(trimmed);
								}
							}}
							placeholder="Search or enter app name"
							type="text"
							value={query}
						/>
					</label>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto border-t border-outline-variant">
					{showCreate ? (
						<button
							className="flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-hover-surface"
							onClick={() => submit(trimmed)}
							type="button"
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
						</button>
					) : null}

					{matches.map((name) => (
						<button
							key={name}
							className="flex w-full items-center gap-3 border-t border-outline-variant/60 px-6 py-3 text-left transition-colors hover:bg-hover-surface"
							onClick={() => submit(name)}
							type="button"
						>
							<span
								aria-hidden="true"
								className="flex size-8 shrink-0 items-center justify-center rounded bg-primary text-helper font-semibold text-on-primary"
							>
								{name.slice(0, 1)}
							</span>
							<span className="text-body-md font-medium text-on-surface">{name}</span>
						</button>
					))}
				</div>
			</div>
		</dialog>
	);
}
