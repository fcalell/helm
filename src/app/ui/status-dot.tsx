// The live-connection dot in the board header. A 10px disc carries no label,
// so it is not a Badge; the tooltip beside it says what the colour means.
// `inline-block`, because an inline span takes no box and the disc vanishes.
export function StatusDot(props: { ok: boolean }) {
	return (
		<span
			class={`inline-block size-2.5 rounded-full ${props.ok ? "bg-ok" : "bg-danger"}`}
			aria-hidden="true"
		/>
	);
}
