import { useEnterOnce } from "@/app/motion/use-enter-once";
import { ResizeHandle } from "@/app/resize/resize-handle";
import { usePanelWidth } from "@/app/resize/use-panel-width";
import { useApps } from "@/features/apps/hooks/use-apps";
import { ElementActionDialog } from "@/features/inspector/components/element-action-dialog";
import { SaveAsTestCaseDialog } from "@/features/inspector/components/save-as-test-case-dialog";
import { ScreenshotPanel } from "@/features/inspector/components/screenshot-panel";
import { ScriptPanel } from "@/features/inspector/components/script-panel";
import { useInspectorFeed } from "@/features/inspector/hooks/use-inspector-feed";
import { useScriptSession } from "@/features/inspector/hooks/use-script-session";
import { defaultCaseNameFromScript, scriptHasBody } from "@/features/inspector/utils/script-text";
import { useValue } from "@legendapp/state/react";
import {
	appStartTarget,
	formatCaseScriptFileErrors,
	parseCaseScriptFile,
} from "@yoqa/runner-client";
import { useMemo, useRef } from "react";

/** The Device panel opens at this width; the script side always keeps at least `SCRIPT_MIN_WIDTH`. */
const DEVICE_PANEL_DEFAULT_WIDTH = 360;
const DEVICE_PANEL_MIN_WIDTH = 300;
const SCRIPT_MIN_WIDTH = 360;
/** The splitter takes the place of the old `gap-5`. */
const HANDLE_WIDTH = 20;

export function InspectorPage() {
	const entered = useEnterOnce(true);
	const columnsRef = useRef<HTMLDivElement>(null);
	const devicePanel = usePanelWidth({
		storageKey: "yoqa.inspector.devicePanelWidth",
		defaultWidth: DEVICE_PANEL_DEFAULT_WIDTH,
		bounds: () => ({
			min: DEVICE_PANEL_MIN_WIDTH,
			max:
				(columnsRef.current?.clientWidth ?? Number.POSITIVE_INFINITY) -
				SCRIPT_MIN_WIDTH -
				HANDLE_WIDTH,
		}),
	});
	const { selectedApp } = useApps();
	const feed = useInspectorFeed(selectedApp?.id);
	const script = useScriptSession({
		controller: feed.controller,
		selectedApp,
	});

	const elements = useValue(feed.feed$.elements);
	const selection = useValue(feed.feed$.selection);
	const liveControl = useValue(feed.feed$.liveControl);
	const scriptText = useValue(script.script$.text);
	const running = useValue(script.script$.running);
	const saveOpen = useValue(script.script$.saveOpen);
	const savingCase = useValue(script.script$.saving);
	const saveError = useValue(script.script$.saveError);
	const casePreview = useMemo(() => parseCaseScriptFile(scriptText), [scriptText]);

	const connected = feed.active != null;
	const canSaveAsCase = Boolean(selectedApp) && scriptHasBody(scriptText);
	const snippetContext = useMemo(
		() => ({
			// Without a session the snippets name the iOS bundle id.
			defaultAppId: appStartTarget(selectedApp, feed.active?.platform ?? "ios") ?? "",
		}),
		[feed.active?.platform, selectedApp],
	);

	return (
		<div
			className={[
				"flex h-full min-h-0 flex-col gap-5 px-4 pb-4",
				entered ? "motion-enter-done" : "motion-enter",
			].join(" ")}
		>
			<div ref={columnsRef} className="flex min-h-0 flex-1">
				<div
					className="h-full min-h-0 min-w-75 shrink overflow-y-auto"
					style={{
						flexBasis: devicePanel.width,
						maxWidth: `calc(100% - ${SCRIPT_MIN_WIDTH + HANDLE_WIDTH}px)`,
					}}
				>
					<ScreenshotPanel
						feed$={feed.feed$}
						visible$={feed.page$.visible}
						session={feed.activeSession}
						onConnect={feed.handleConnect}
						onDisconnect={feed.handleDisconnect}
						onLiveControlChange={feed.handleLiveControlChange}
						disabled={!connected || running || feed.viewOnly}
						onSelect={feed.handleSelect}
						onSelectWithPoint={feed.handleSelectWithPoint}
						onRefreshTree={feed.handleRefreshTree}
						onDoubleTap={script.handleDoubleTap}
						onPointer={feed.sendPointer}
						onClearSelection={() => feed.handleSelect(null)}
					/>
				</div>

				<ResizeHandle panel={devicePanel} edge="end" label="Resize device panel" className="w-5" />

				<div className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto">
					<ScriptPanel
						script$={script.script$}
						canRun={connected && !running && !feed.viewOnly && scriptHasBody(scriptText)}
						canSaveAsCase={canSaveAsCase}
						onRun={() => {
							void script.handleRun();
						}}
						onStop={script.handleStop}
						onCopy={script.handleCopy}
						onExport={script.handleExport}
						onExportShell={script.handleExportShell}
						onOpenFile={script.handleOpenFile}
						onPasteText={script.handlePasteText}
						onExportReportHtml={() => {
							script.handleExportReport("html");
						}}
						onExportReportMarkdown={() => {
							script.handleExportReport("md");
						}}
						onSaveAsCase={script.openSaveAsCase}
					/>
				</div>
			</div>

			<ElementActionDialog
				selection={liveControl ? null : selection}
				elements={elements}
				disabled={!connected || running || feed.viewOnly}
				snippetContext={snippetContext}
				canChangeSelector={Boolean(selection?.element)}
				onChangeSelector={feed.handleChangeSelector}
				onInsert={script.handleInsertLines}
				onInsertAndRun={script.handleInsertAndRunLines}
				onCopyLines={script.handleCopyLines}
				onClose={() => feed.handleSelect(null)}
				gesturesDisabled={running || feed.viewOnly}
				onAddSwipe={script.handleAddSwipe}
				onAddWait={script.handleAddWait}
			/>

			<SaveAsTestCaseDialog
				isOpen={saveOpen}
				onOpenChange={script.setSaveOpen}
				defaultName={defaultCaseNameFromScript(scriptText)}
				appName={selectedApp?.name ?? null}
				actionCount={casePreview.ok ? casePreview.script.actions.length : 0}
				warnings={casePreview.ok ? [] : formatCaseScriptFileErrors(casePreview.errors).split("\n")}
				saving={savingCase}
				error={saveError}
				onConfirm={(name) => {
					void script.handleSaveAsCase(name);
				}}
			/>
		</div>
	);
}
