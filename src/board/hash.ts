// FNV-1a 64-bit over the brief body. Not cryptographic: the hash only detects
// that a brief changed since the gate verdict, and it must run in the browser
// bundle too (the client pre-checks moves), so no node:crypto.
export function briefHash(body: string): string {
	let hash = 0xcbf29ce484222325n;
	for (let i = 0; i < body.length; i++) {
		hash ^= BigInt(body.charCodeAt(i));
		hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
	}
	return hash.toString(16).padStart(16, "0");
}
