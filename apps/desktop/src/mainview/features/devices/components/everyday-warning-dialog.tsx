import { everydayWarningLine } from "@/features/devices/utils/everyday-browser";
import { AlertDialog, Button } from "@heroui/react";

/** The first-use warning an App shows before its first connect to an Everyday browser. */
export type EverydayWarningPrompt = {
	browserName: string;
	/** The runner's own warning text, from its 428. */
	warning: string;
};

/**
 * Ask once per App before the agent acts in the user's signed-in browser. Continue connects
 * with the warning accepted, and the runner remembers it for the App; Cancel connects nothing.
 */
export function EverydayWarningDialog({
	prompt,
	onAnswer,
}: {
	prompt: EverydayWarningPrompt | null;
	onAnswer: (accepted: boolean) => void;
}) {
	return (
		<AlertDialog>
			<AlertDialog.Backdrop
				isOpen={prompt != null}
				onOpenChange={(open) => !open && onAnswer(false)}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[440px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="warning" />
							<AlertDialog.Heading>Use your own {prompt?.browserName}?</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body className="flex flex-col gap-3">
							<p className="m-0 font-medium">
								{prompt ? everydayWarningLine(prompt.browserName) : null}
							</p>
							<p className="m-0 text-body-sm text-on-surface-variant">{prompt?.warning}</p>
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button onPress={() => onAnswer(false)} variant="tertiary">
								Cancel
							</Button>
							<Button onPress={() => onAnswer(true)}>Continue</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</AlertDialog>
	);
}
