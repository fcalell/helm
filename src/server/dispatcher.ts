// The serial dispatcher every non-chat kind rides (`adversary` today,
// `research` and runs later): one session at a time, spawned in enqueue
// order. Chat kinds bypass it — a person is waiting on those.
let tail: Promise<unknown> = Promise.resolve();

export function dispatch<T>(task: () => Promise<T>): Promise<T> {
	const result = tail.then(task);
	tail = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}
