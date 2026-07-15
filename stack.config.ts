import { defineConfig } from "@fcalell/cli";
import { api } from "@fcalell/plugin-api";
import { node } from "@fcalell/plugin-node";
import { solid } from "@fcalell/plugin-solid";
import { solidUi } from "@fcalell/plugin-solid-ui";
import { vite } from "@fcalell/plugin-vite";

export default defineConfig({
	app: {
		name: "helm",
		// Seeds the CORS allow-list only; every client is same-origin (one
		// process serves API, WS, and the SPA), so no real domain exists.
		domain: "helm.localhost",
	},
	plugins: [api(), node(), vite(), solid({ title: "Helm" }), solidUi()],
});
