import { createWsClient, type WsClient } from "@fcalell/plugin-node/client";

// One socket for the whole app; channels multiplex over it.
let client: WsClient | undefined;

export function wsClient(): WsClient {
	client ??= createWsClient();
	return client;
}
