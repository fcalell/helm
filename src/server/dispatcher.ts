import type { SessionKind } from "../sessions/kinds.ts";

// One session at a time, spawned in enqueue order; chat kinds bypass it.
const CAP = 1;

export interface DispatchMeta {
	kind: SessionKind;
	storyId?: string;
}

export interface QueueSnapshot {
	cap: number;
	running: DispatchMeta[];
	queued: DispatchMeta[];
}

// Rejects a cancelled entry's dispatch promise; the task never ran.
export class QueueCancelledError extends Error {
	constructor() {
		super("removed from the queue before running");
	}
}

interface Entry {
	meta: DispatchMeta;
	run: () => void;
	cancel: () => void;
}

const running: DispatchMeta[] = [];
const waiting: Entry[] = [];
const listeners = new Set<() => void>();

// Fired on every enqueue, start, settle, and cancel.
export function onQueueChange(listener: () => void): void {
	listeners.add(listener);
}

function notify(): void {
	for (const listener of listeners) listener();
}

export function queueSnapshot(): QueueSnapshot {
	return {
		cap: CAP,
		running: [...running],
		queued: waiting.map((entry) => entry.meta),
	};
}

function advance(): void {
	if (running.length >= CAP) return;
	const entry = waiting.shift();
	if (entry === undefined) return;
	running.push(entry.meta);
	notify();
	entry.run();
}

export function dispatch<T>(
	task: () => Promise<T>,
	meta: DispatchMeta,
	options?: { front?: boolean },
): Promise<T> {
	const { promise, resolve, reject } = Promise.withResolvers<T>();
	const entry: Entry = {
		meta,
		run: () => {
			Promise.resolve()
				.then(task)
				.then(resolve, reject)
				.finally(() => {
					const index = running.indexOf(meta);
					if (index !== -1) running.splice(index, 1);
					notify();
					advance();
				});
		},
		cancel: () => reject(new QueueCancelledError()),
	};
	if (options?.front === true) waiting.unshift(entry);
	else waiting.push(entry);
	notify();
	advance();
	return promise;
}

// Removes the story's queued (never running) run entry; kind-scoped so a
// queued gate round for the same story survives a run.dequeue.
export function cancelQueued(storyId: string): boolean {
	const index = waiting.findIndex(
		(entry) => entry.meta.kind === "run" && entry.meta.storyId === storyId,
	);
	if (index === -1) return false;
	const [entry] = waiting.splice(index, 1);
	entry?.cancel();
	notify();
	return true;
}
