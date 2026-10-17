import { showErrorToast } from "@/app/show-error-toast";
import type { Application } from "@/features/apps/data/api/apps";
import { readRunScreenshots } from "@/features/runs/data/api/runs";
import {
	type CaseLabelMeta,
	formatCaseLabel,
	formatDeviceLabel,
} from "@/features/runs/utils/labels";
import { exportRunReport } from "@/features/runs/utils/run-report";
import { isTerminalRunStatus } from "@/features/runs/utils/run-status";
import { flattenSteps } from "@/features/runs/utils/run-steps";
import { useObservable, useValue } from "@legendapp/state/react";
import { type Device, type Run, buildRunReportFromCatalogRun } from "@yoqa/runner-client";

type ReportContext = {
	app: Application | null;
	caseNameById: Map<string, CaseLabelMeta>;
	devices: Device[];
};

/** Export a finished Run as an HTML or Markdown report, with its step screenshots inlined. */
export function useRunReportExport() {
	const exporting$ = useObservable<"html" | "md" | null>(null);
	const exportingFormat = useValue(exporting$);

	const exportReport = async (
		run: Run | undefined,
		format: "html" | "md",
		context: ReportContext,
	) => {
		if (!run || !isTerminalRunStatus(run.status)) return;
		exporting$.set(format);
		try {
			const stepIds = flattenSteps(run)
				.filter((step) => step.screenshotUri)
				.map((step) => step.id);
			const screenshotsByStepId = await readRunScreenshots(run, stepIds);

			const caseTitles: Record<string, string> = {};
			for (const test of run.tests) {
				caseTitles[test.caseId] = formatCaseLabel(
					context.caseNameById.get(test.caseId),
					test.caseId,
				);
			}

			const deviceRow = context.devices.find((row) => row.id === run.deviceId);
			const doc = buildRunReportFromCatalogRun(
				run,
				{
					appLabel: context.app?.name ?? null,
					deviceLabel: formatDeviceLabel(deviceRow, {
						deviceId: run.deviceId,
						platform: run.platform,
					}),
					caseTitles,
				},
				screenshotsByStepId,
			);
			exportRunReport(doc, format);
		} catch (error) {
			showErrorToast(error, "Failed to export report");
		} finally {
			exporting$.set(null);
		}
	};

	return { exportingFormat, exportReport };
}
