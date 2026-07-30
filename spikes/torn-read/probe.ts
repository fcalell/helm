// Measures whether a reader outside the write queue can observe a partially
// written board file. Two arms over the same loop: a control writing the
// target with a bare `writeFile`, and the product's `writeStory`. The writer
// alternates two versions of one story, so any read that equals neither is
// torn, whether it was truncated or half-filled.
//
// Run: node spikes/torn-read/probe.ts

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeStory } from "../../src/board/markdown.ts";
import type { StoryFrontmatter } from "../../src/board/schema.ts";
import { writeStory } from "../../src/board/store.ts";

const READS = 20_000;
const BODY_BYTES = 40_000;

interface Version {
	frontmatter: StoryFrontmatter;
	body: string;
}

function version(marker: string): Version {
	const line = `${marker.repeat(78)}\n`;
	const filler = line.repeat(Math.ceil(BODY_BYTES / line.length));
	return {
		frontmatter: {
			id: "001-01",
			status: "refining",
			depends: [],
			sessions: {},
			runs: [],
		},
		body: `# Torn read probe ${marker}\n\n## Goal\n\n${filler}`,
	};
}

interface ArmResult {
	torn: number;
	reads: number;
	writes: number;
}

async function arm(
	path: string,
	versions: readonly [Version, Version],
	write: (which: 0 | 1) => Promise<void>,
): Promise<ArmResult> {
	const expected = versions.map((each) =>
		serializeStory(each.frontmatter, each.body),
	);
	await write(0);
	let torn = 0;
	let writes = 0;
	let stop = false;
	const writer = (async () => {
		for (let n = 0; !stop; n += 1) {
			await write((n % 2) as 0 | 1);
			writes += 1;
		}
	})();
	for (let n = 0; n < READS; n += 1) {
		try {
			const raw = await readFile(path, "utf8");
			if (!expected.includes(raw)) torn += 1;
		} catch {
			torn += 1;
		}
	}
	stop = true;
	await writer;
	return { torn, reads: READS, writes };
}

const dir = await mkdtemp(join(tmpdir(), "helm-torn-read-"));
const versions = [version("a"), version("b")] as const;

try {
	const controlPath = join(dir, "01-control.md");
	const control = await arm(controlPath, versions, async (which) => {
		const each = versions[which];
		await writeFile(
			controlPath,
			serializeStory(each.frontmatter, each.body),
			"utf8",
		);
	});
	const productPath = join(dir, "01-product.md");
	const product = await arm(productPath, versions, (which) =>
		writeStory({ path: productPath, ...versions[which] }),
	);

	const line = (label: string, result: ArmResult): string =>
		`${label}: ${result.torn} torn in ${result.reads} reads (${((result.torn / result.reads) * 100).toFixed(2)}%), ${result.writes} writes`;
	console.log(`node ${process.version}, body ${BODY_BYTES} bytes`);
	console.log(line("control (writeFile)", control));
	console.log(line("product (writeStory)", product));

	const controlSees = control.torn > 0;
	const productClean = product.torn === 0;
	console.log(
		`control sees a tear: ${controlSees}; product is clean: ${productClean}`,
	);
	process.exitCode = controlSees && productClean ? 0 : 1;
} finally {
	await rm(dir, { recursive: true, force: true });
}
