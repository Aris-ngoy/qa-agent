type ViewTransitionLike = {
	finished: Promise<void>;
};

export function startViewTransition(update: () => void): void {
	const doc = document as Document & {
		startViewTransition?: (cb: () => void) => ViewTransitionLike;
	};

	if (typeof doc.startViewTransition === "function") {
		doc.startViewTransition(update);
		return;
	}

	update();
}
