/** Apple physical UDIDs look like `00008120-000E6D813E2A601E` (not a standard UUID). */
export function looksLikePhysicalIosUdid(udid: string): boolean {
	return /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}$/.test(udid.trim());
}
