import { describe, expect, test } from "bun:test";
import {
	removeChatSummary,
	resolveOpenChatId,
	sortChatsNewestFirst,
	upsertChatSummary,
} from "@/features/auto/utils/chat-list";
import type { AutoChatSummary } from "@yoqa/runner-client";

function summary(id: string, updatedAt: number, title = id): AutoChatSummary {
	return {
		id,
		appId: "app_1",
		caseId: null,
		caseNumber: null,
		caseName: null,
		title,
		providerId: "prov_claude",
		model: null,
		createdAt: updatedAt,
		updatedAt,
	};
}

const chats = [summary("old", 1), summary("newest", 3), summary("middle", 2)];

describe("sortChatsNewestFirst", () => {
	test("puts the chat touched last first", () => {
		expect(sortChatsNewestFirst(chats).map((chat) => chat.id)).toEqual(["newest", "middle", "old"]);
	});
});

describe("upsertChatSummary", () => {
	test("adds a new chat at the top", () => {
		expect(upsertChatSummary(chats, summary("fresh", 4)).map((chat) => chat.id)).toEqual([
			"fresh",
			"newest",
			"middle",
			"old",
		]);
	});

	test("replaces a chat by id", () => {
		const next = upsertChatSummary(chats, summary("old", 5, "Renamed"));
		expect(next.map((chat) => chat.id)).toEqual(["old", "newest", "middle"]);
		expect(next[0]?.title).toBe("Renamed");
	});
});

describe("removeChatSummary", () => {
	test("drops the chat", () => {
		expect(removeChatSummary(chats, "middle").map((chat) => chat.id)).toEqual(["old", "newest"]);
	});
});

describe("resolveOpenChatId", () => {
	test("opens the chat the search param names", () => {
		expect(resolveOpenChatId("middle", chats)).toBe("middle");
	});

	test("opens the newest chat without one", () => {
		expect(resolveOpenChatId(undefined, chats)).toBe("newest");
	});

	test("opens the newest when the named chat is not this App's", () => {
		expect(resolveOpenChatId("gone", chats)).toBe("newest");
	});

	test("opens the named chat while the list loads, and nothing without one", () => {
		expect(resolveOpenChatId("middle", undefined)).toBe("middle");
		expect(resolveOpenChatId(undefined, undefined)).toBeNull();
	});

	test("opens nothing for an App with no chats", () => {
		expect(resolveOpenChatId(undefined, [])).toBeNull();
	});
});
