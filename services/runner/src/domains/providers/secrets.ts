import {
	type CipherGCM,
	type DecipherGCM,
	createCipheriv,
	createDecipheriv,
	randomBytes,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const YOQA_ROOT = join(homedir(), ".yoqa");
const KEY_PATH = join(YOQA_ROOT, ".provider-key");
const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function toBytes(value: Buffer | Uint8Array): Uint8Array {
	return Uint8Array.from(value);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function ensureProviderKey(): Uint8Array {
	mkdirSync(YOQA_ROOT, { recursive: true });
	if (existsSync(KEY_PATH)) {
		const existing = toBytes(readFileSync(KEY_PATH));
		if (existing.length === KEY_LENGTH) {
			return existing;
		}
	}
	const key = toBytes(randomBytes(KEY_LENGTH));
	writeFileSync(KEY_PATH, key, { mode: 0o600 });
	try {
		chmodSync(KEY_PATH, 0o600);
	} catch {
		// Best-effort on platforms that ignore mode.
	}
	return key;
}

/** Encrypt an API key. Returns `iv:authTag:ciphertext` (base64 parts). */
export async function encryptApiKey(plaintext: string): Promise<string> {
	const key = ensureProviderKey();
	const iv = toBytes(randomBytes(IV_LENGTH));
	const cipher = createCipheriv(ALGORITHM, key as never, iv as never) as CipherGCM;
	const encrypted = concatBytes([
		toBytes(cipher.update(plaintext, "utf8")),
		toBytes(cipher.final()),
	]);
	const authTag = toBytes(cipher.getAuthTag());
	return `${bytesToBase64(iv)}:${bytesToBase64(authTag)}:${bytesToBase64(encrypted)}`;
}

/** Decrypt an API key from `iv:authTag:ciphertext` format. */
export async function decryptApiKey(payload: string): Promise<string> {
	const parts = payload.split(":");
	if (parts.length !== 3) {
		throw new Error("Invalid encrypted API key payload");
	}
	const [ivB64, tagB64, dataB64] = parts;
	if (!ivB64 || !tagB64 || !dataB64) {
		throw new Error("Invalid encrypted API key payload");
	}
	const key = ensureProviderKey();
	const iv = base64ToBytes(ivB64);
	const authTag = base64ToBytes(tagB64);
	const data = base64ToBytes(dataB64);
	const decipher = createDecipheriv(ALGORITHM, key as never, iv as never) as DecipherGCM;
	decipher.setAuthTag(authTag as never);
	const plain = concatBytes([toBytes(decipher.update(data as never)), toBytes(decipher.final())]);
	return new TextDecoder().decode(plain);
}

export function apiKeyLast4(apiKey: string): string {
	const trimmed = apiKey.trim();
	if (trimmed.length <= 4) return trimmed;
	return trimmed.slice(-4);
}

export async function encryptEnvMap(env: Record<string, string>): Promise<string> {
	return encryptApiKey(JSON.stringify(env));
}

export async function decryptEnvMap(payload: string): Promise<Record<string, string>> {
	const raw = await decryptApiKey(payload);
	const parsed: unknown = JSON.parse(raw);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Invalid encrypted env map payload");
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (typeof value === "string") {
			out[key] = value;
		}
	}
	return out;
}

/** Names of env keys that are set (values never returned to the client). */
export function envKeyNames(env: Record<string, string>): string[] {
	return Object.keys(env).sort();
}

export function getProviderKeyPathForTests(): string {
	return KEY_PATH;
}

export function getProviderKeyDirForTests(): string {
	return dirname(KEY_PATH);
}
