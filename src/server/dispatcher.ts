// One session at a time, spawned in enqueue order; chat kinds bypass it.
let tail: Promise<unknown> = Promise.resolve();

export function dispatch<T>(task: () => Promise<T>): Promise<T> {
	const result = tail.then(task);
	tail = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}
