import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import { procedure } from "virtual:stack-procedure";
import { managedRepo } from "../../server/services/board.ts";

const execFileAsync = promisify(execFile);

async function currentBranch(path: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", [
			"-C",
			path,
			"branch",
			"--show-current",
		]);
		return stdout.trim();
	} catch {
		return "";
	}
}

export const repo = {
	get: procedure().handler(async () => {
		const { path, mainBranch } = managedRepo();
		return {
			path,
			name: basename(path),
			mainBranch,
			branch: await currentBranch(path),
		};
	}),
};
