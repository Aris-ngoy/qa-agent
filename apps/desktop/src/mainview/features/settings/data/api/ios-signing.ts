import { getRunnerClient } from "@/app/runner-client";

export async function getIosSigning() {
	return (await getRunnerClient()).getIosSigning();
}

export async function setIosSigningTeam(team: string | null) {
	return (await getRunnerClient()).setIosSigningTeam(team);
}

export async function checkIosSigning(deviceId: string) {
	return (await getRunnerClient()).checkIosSigning({ deviceId });
}
