import { homedir } from "node:os";
import { join } from "node:path";

/** Where each Auto chat's working folder lives; `YOQA_AUTO_CHATS_DIR` moves it (tests). */
export function autoChatsDir(): string {
	return process.env.YOQA_AUTO_CHATS_DIR ?? join(homedir(), ".yoqa", "auto-chats");
}

/** The chat agent's working folder for one chat: empty, and nothing of the user's. */
export function autoChatDir(chatId: string): string {
	return join(autoChatsDir(), chatId);
}
