// Serialize read-validate-write so concurrent board writes (moves, session
// attaches) can't validate against each other's stale disk state.
// Single-repo for v1.
// TODO: key by repo when multi-repo boards land (roadmap).
let writeQueue: Promise<unknown> = Promise.resolve();

export function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
	const result = writeQueue.then(task);
	writeQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}
