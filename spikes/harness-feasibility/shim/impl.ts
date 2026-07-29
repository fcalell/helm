// The `.ts` sibling the extensionless shim imports: type annotations here
// prove node's type stripping applies through the import.
export function hello(args: string[]): void {
	const label: string = args[0] ?? "none";
	console.log(JSON.stringify({ loaded: "ts-sibling", label }));
}
