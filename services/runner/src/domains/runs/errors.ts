export class RunValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RunValidationError";
	}
}

export class RunNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RunNotFoundError";
	}
}
