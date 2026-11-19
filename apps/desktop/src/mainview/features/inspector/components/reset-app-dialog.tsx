import type { PendingReset } from "@/features/inspector/data/state/script";
import { resetAppConfirmation } from "@/features/inspector/utils/reset-app";
import { AlertDialog, Button } from "@heroui/react";

/**
 * Ask before Insert & Run Resets an App: a Reset clears the App's data and can't be undone.
 * Reset runs the held step; Cancel inserts and runs nothing.
 */
export function ResetAppDialog({
	resets,
	onConfirm,
	onCancel,
}: {
	resets: PendingReset[] | null;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<AlertDialog>
			<AlertDialog.Backdrop isOpen={resets != null} onOpenChange={(open) => !open && onCancel()}>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>Reset the app?</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body className="flex flex-col gap-3">
							{resets?.map((reset) => (
								<p key={`${reset.appId}:${reset.keychain}`} className="m-0">
									{resetAppConfirmation(reset)}
								</p>
							))}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button slot="close" variant="tertiary">
								Cancel
							</Button>
							<Button onPress={onConfirm} variant="danger">
								Reset
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</AlertDialog>
	);
}
