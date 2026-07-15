// Spawn a session, resume it with an answer, resume again with review
// feedback. Prints session IDs per turn: the key question is whether --resume
// keeps or forks the session ID.
import { runClaude, setupToyRepo, summarize, TOY_REPO } from "./lib.ts";

setupToyRepo();

console.log("turn 1: initial prompt");
const first = await runClaude({
	cwd: TOY_REPO,
	prompt:
		"Read math.js. In one line, propose a name for a function that " +
		"subtracts two numbers. Do not edit any files.",
});
console.log(summarize(first));
if (first.sessionId === undefined) throw new Error("no session id");

console.log("\nturn 2: resume with an answer");
const second = await runClaude({
	cwd: TOY_REPO,
	prompt:
		"I pick the name you proposed. Reply with a one-line implementation. " +
		"Do not edit any files.",
	args: ["--resume", first.sessionId],
});
console.log(summarize(second));
if (second.sessionId === undefined) throw new Error("no session id");

console.log("\nturn 3: resume with review feedback");
const third = await runClaude({
	cwd: TOY_REPO,
	prompt:
		"Review feedback: use arrow-function style. Reply with the revised " +
		"one-liner and nothing else.",
	args: ["--resume", second.sessionId],
});
console.log(summarize(third));

console.log("\nsession ids:", [
	first.sessionId,
	second.sessionId,
	third.sessionId,
]);
console.log(
	"resume keeps id:",
	first.sessionId === second.sessionId &&
		second.sessionId === third.sessionId,
);
