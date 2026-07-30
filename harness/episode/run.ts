import { runEpisode } from "./driver.ts";
import { EPISODES } from "./episodes.ts";

const names = EPISODES.map((episode) => episode.name);
const wanted = process.argv[2];

if (wanted === undefined) {
	console.log("usage: node harness/episode/run.ts <episode|all>");
	for (const episode of EPISODES) {
		console.log(
			`  ${episode.name}${episode.halts === true ? " (halts for an operator)" : ""}: ${episode.summary}`,
		);
	}
	process.exit(1);
}

const selected =
	wanted === "all"
		? EPISODES.filter((episode) => episode.halts !== true)
		: EPISODES.filter((episode) => episode.name === wanted);

if (selected.length === 0) {
	console.error(`no episode named ${wanted}; known: ${names.join(", ")}`);
	process.exit(1);
}
if (wanted === "all") {
	const halting = EPISODES.filter((episode) => episode.halts === true);
	console.log(
		`running ${selected.length} unattended episodes; run ${halting.map((episode) => episode.name).join(" and ")} by name, each halts for an operator`,
	);
}

let failed = 0;
for (const episode of selected) {
	if (!(await runEpisode(episode))) failed += 1;
}
console.log(`\n${selected.length - failed}/${selected.length} episodes passed`);
process.exit(failed === 0 ? 0 : 1);
