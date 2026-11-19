import { shownAutoChat$ } from "@/features/auto/data/state/shown-chat";
import { useAutoModels } from "@/features/auto/hooks/usequery/use-auto";
import { chatProviderProblem } from "@/features/auto/utils/chat-labels";
import { useValue } from "@legendapp/state/react";

/** Why the shown chat's Provider cannot answer, once the Providers are read; null while it can. */
export function useProviderProblem(): string | null {
	const modelsQuery = useAutoModels();
	const providerId = useValue(shownAutoChat$.chat.providerId) ?? null;
	if (!modelsQuery.data) return null;
	return chatProviderProblem(modelsQuery.data.providers, { providerId });
}
