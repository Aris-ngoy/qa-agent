import { downloadTextFile } from "@/app/download";
import { showErrorToast } from "@/app/show-error-toast";
import { toast } from "@heroui/react";
import {
	type RunReportDocument,
	formatRunReportHtml,
	formatRunReportMarkdown,
	suggestedRunReportBasename,
} from "@yoqa/runner-client";

/** Download a Run report as HTML or Markdown and say so; a failure shows a toast. */
export function exportRunReport(report: RunReportDocument, format: "html" | "md") {
	try {
		const baseName = suggestedRunReportBasename(report);
		if (format === "html") {
			downloadTextFile(`${baseName}.html`, formatRunReportHtml(report), "text/html;charset=utf-8");
			toast.success("HTML report exported");
		} else {
			downloadTextFile(
				`${baseName}.md`,
				formatRunReportMarkdown(report),
				"text/markdown;charset=utf-8",
			);
			toast.success("Markdown report exported");
		}
	} catch (error) {
		showErrorToast(error, "Failed to export report");
	}
}
