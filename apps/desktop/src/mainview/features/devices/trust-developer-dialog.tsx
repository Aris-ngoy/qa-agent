import { Button, Modal, Spinner } from "@heroui/react";
import type { DeveloperNotTrusted } from "@yoqa/runner-client";

/**
 * A free Personal Team's YoqaRunner is installed on the iPhone, but the phone does not trust
 * the developer yet. Only the user can trust it on the phone; this walks them through it and
 * reconnects. The next connect reuses the build, so it only launches the runner.
 */
export function TrustDeveloperDialog({
	untrusted,
	reconnecting,
	onReconnect,
	onClose,
}: {
	untrusted: DeveloperNotTrusted | null;
	reconnecting: boolean;
	onReconnect: () => void;
	onClose: () => void;
}) {
	const certificate = untrusted?.certificate ?? `Apple Development (team ${untrusted?.team ?? ""})`;
	return (
		<Modal>
			<Modal.Backdrop
				isOpen={untrusted !== null}
				onOpenChange={(open) => {
					if (!open) onClose();
				}}
				variant="opaque"
			>
				<Modal.Container placement="center" size="md">
					<Modal.Dialog className="sm:max-w-lg">
						<Modal.CloseTrigger />
						<Modal.Header className="flex flex-col gap-1">
							<Modal.Heading>Trust the developer on your iPhone</Modal.Heading>
							<p className="text-body-sm text-on-surface-variant">
								YoqaRunner is installed. Your free Personal Team needs to be trusted once on the
								iPhone before it can start.
							</p>
						</Modal.Header>
						<Modal.Body>
							<ol className="list-decimal space-y-2 pl-5 text-body-md text-on-surface">
								<li>
									Unlock the iPhone and open{" "}
									<span className="font-medium">
										Settings › General › VPN &amp; Device Management
									</span>
									.
								</li>
								<li>
									Under <span className="font-medium">Developer App</span>, tap{" "}
									<span className="font-medium break-all">{certificate}</span>.
								</li>
								<li>
									Tap <span className="font-medium">Trust</span>, then{" "}
									<span className="font-medium">Trust</span> again to confirm.
								</li>
								<li>Keep the iPhone unlocked and press Reconnect.</li>
							</ol>
							<p className="mt-3 text-body-sm text-on-surface-variant">
								The iPhone needs an internet connection to verify the developer. You only do this
								once per team on each iPhone.
							</p>
						</Modal.Body>
						<Modal.Footer>
							<Button isDisabled={reconnecting} onPress={onClose} size="sm" variant="secondary">
								Later
							</Button>
							<Button isDisabled={reconnecting} onPress={onReconnect} size="sm" variant="primary">
								{reconnecting ? <Spinner size="sm" /> : null}
								{reconnecting ? "Reconnecting…" : "Reconnect"}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
