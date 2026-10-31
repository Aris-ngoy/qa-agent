import type { Application } from "@/features/apps/data/api/apps";
import { useApps } from "@/features/apps/hooks/use-apps";
import { useRetargetSession } from "@/features/devices/hooks/usequery/use-retarget-session";
import type { InspectorFeed$ } from "@/features/inspector/data/state/feed";
import { treePanelElements, treePanelFor } from "@/features/inspector/utils/tree-source";
import { useValue } from "@legendapp/state/react";
import { type ActiveDeviceResponse, appStartTarget } from "@yoqa/runner-client";
import { useCallback } from "react";

/**
 * Where the Device panel's tree came from and what it shows of it: the app tree, "No target
 * app" with the app selector, or SpringBoard's elements behind the toggle. Choosing an app
 * there makes it the session's target app; the feed reads the tree again when it is.
 */
export function useTreePanel(feed$: InspectorFeed$, session: ActiveDeviceResponse | null) {
	const { apps, selectedApp, selectApp } = useApps();
	const retarget = useRetargetSession();
	const source = useValue(feed$.source);
	const showSystem = useValue(feed$.showSystemTree);
	const allElements = useValue(feed$.elements);

	const panel = treePanelFor({ source, hasTargetApp: Boolean(session?.targetApp), showSystem });
	const elements = treePanelElements(panel, allElements);
	/** Apps the session's platform can target. */
	const targetableApps: Application[] = session
		? apps.filter((app) => appStartTarget(app, session.platform))
		: [];

	const chooseApp = useCallback(
		(appId: string) => {
			const app = apps.find((candidate) => candidate.id === appId);
			if (!app || !session) return;
			// Selecting another app retargets the session from the top bar; the one already
			// selected is retargeted here, since the session was opened without it.
			if (app.id !== selectedApp?.id) {
				selectApp(app.id);
				return;
			}
			void retarget(session, app);
		},
		[apps, retarget, selectApp, selectedApp?.id, session],
	);

	return { panel, elements, targetableApps, chooseApp };
}
