import { getRunnerClient } from "@/app/runner-client";
import type { DoctorReport } from "@yoqa/runner-client";

export async function getDoctorReport(): Promise<DoctorReport> {
	return (await getRunnerClient()).getDoctorReport();
}

/** Run every safe repair the report's steps offer; refuses when there is none. */
export async function repairDoctor(report: DoctorReport) {
	const repairs = [
		...new Set(
			report.steps
				.map((step) => step.repair)
				.filter((id): id is NonNullable<typeof id> => Boolean(id)),
		),
	];
	if (repairs.length === 0) {
		throw new Error("No safe repairs available");
	}
	return (await getRunnerClient()).repairDoctor({ repairs });
}
