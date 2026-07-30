import { startNodeServer } from "@fcalell/plugin-node/server";

// The scratch orchestrator's entry. It must live inside this repo: node
// resolves bare specifiers by walking up from the importing file, so an entry
// written into the scratch directory cannot find `@fcalell/plugin-node`, and
// NODE_PATH does not apply to ESM. Everything the harness isolates is
// cwd-relative anyway (`helm.config.json`, `src/server/config.ts:20`, and
// `staticRoot`), so the entry stays here and the process runs from the
// scratch directory. `.stack/server.ts` cannot serve: its port is hardcoded
// to the one `stack dev` owns.

const HELM = new URL("../../", import.meta.url);

await startNodeServer({
	port: Number(process.env.HELM_HARNESS_PORT ?? 8797),
	workerModule: new URL(".stack/worker.ts", HELM),
	procedureModule: new URL(".stack/procedure.ts", HELM),
	servicesModule: new URL("src/server/services/index.ts", HELM),
	workerPaths: ["/rpc"],
	staticRoot: "dist/client",
});
