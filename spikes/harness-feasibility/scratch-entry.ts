// The scratch orchestrator entry. It must live *inside* the helm repo: node
// resolves bare specifiers by walking up from the importing file, so an entry
// written into the scratch cwd cannot find `@fcalell/plugin-node` (measured,
// and NODE_PATH does not apply to ESM). Everything the harness wants isolated
// is cwd-relative instead — `helm.config.json` (`src/server/config.ts:20`) and
// `staticRoot` (`create-node-server.ts:53`) — so the entry stays here and the
// *process* runs from the scratch directory.
//
// The port differs from `.stack/server.ts`'s hardcoded 8788, which `stack dev`
// already owns.
import { startNodeServer } from "@fcalell/plugin-node/server";

const HELM = new URL("../../", import.meta.url);

await startNodeServer({
	port: Number(process.env.HELM_SCRATCH_PORT ?? 8799),
	workerModule: new URL(".stack/worker.ts", HELM),
	procedureModule: new URL(".stack/procedure.ts", HELM),
	servicesModule: new URL("src/server/services/index.ts", HELM),
	workerPaths: ["/rpc"],
	staticRoot: "dist/client",
});
