export class RpcError extends Error {
	readonly status: number;
	readonly body: string;

	constructor(path: string, status: number, body: string) {
		super(`POST /rpc/${path} -> ${status} ${body}`);
		this.name = "RpcError";
		this.status = status;
		this.body = body;
	}
}

export type RpcCall = <T>(path: string, input: unknown) => Promise<T>;

// `POST /rpc/<route>/<procedure>` with a `{json: …}` envelope both ways.
export function rpcClient(base: string): RpcCall {
	return async <T>(path: string, input: unknown): Promise<T> => {
		const response = await fetch(`${base}/rpc/${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ json: input }),
		});
		const text = await response.text();
		if (!response.ok) throw new RpcError(path, response.status, text);
		if (text === "") return undefined as T;
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed === "object" && parsed !== null && "json" in parsed) {
			return (parsed as { json: T }).json;
		}
		return parsed as T;
	};
}
