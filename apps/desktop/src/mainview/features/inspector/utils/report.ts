import { showErrorToast } from "@/app/show-error-toast";
import { toast } from "@heroui/react";
import {
	type RunReportDocument,
	formatRunReportHtml,
	formatRunReportMarkdown,
	suggestedRunReportBasename,
} from "@yoqa/runner-client";

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

export function downloadTextFile(filename: string, contents: string, mime: string) {
	const blob = new Blob([contents], { type: mime });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

export function notify(message: string) {
	toast.success(message);
}

export function exportRunReport(report: RunReportDocument, format: "html" | "md") {
	try {
		const baseName = suggestedRunReportBasename(report);
		if (format === "html") {
			downloadTextFile(`${baseName}.html`, formatRunReportHtml(report), "text/html;charset=utf-8");
			notify("HTML report exported");
		} else {
			downloadTextFile(
				`${baseName}.md`,
				formatRunReportMarkdown(report),
				"text/markdown;charset=utf-8",
			);
			notify("Markdown report exported");
		}
	} catch (error) {
		showErrorToast(error, "Failed to export report");
	}
}
