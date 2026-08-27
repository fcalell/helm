import {
	createPanelWidth,
	DockedPanel,
} from "@fcalell/plugin-solid-ui/components/docked-panel";
import type { JSX } from "solid-js";
import { createSignal, onMount, Show } from "solid-js";
import { IconButton } from "./icon-button.tsx";

// Helm's chat panel: a docked layout region beside the board, not a dialog,
// so no overlay, focus trap, or Escape dismiss; closing is the chrome button.
// The expand flag lives at module scope so it survives close and reopen;
// `createPanelWidth` re-reads localStorage on each mount, so the dragged
// width survives too.
const [expanded, setExpanded] = createSignal(false);

export function ChatDrawer(props: {
	title: JSX.Element;
	onClose: () => void;
	children: JSX.Element;
}) {
	const [width, setWidth] = createPanelWidth({
		key: "helm.chat-panel-width",
		defaultWidth: 576,
	});
	// `maxWidth` takes pixels, so the 75vw cap (the old expanded width) is
	// measured from the viewport after mount; 720 covers the server render.
	const [max, setMax] = createSignal(720);
	onMount(() => setMax(Math.round(window.innerWidth * 0.75)));

	return (
		<DockedPanel
			width={expanded() ? max() : width()}
			maxWidth={max()}
			onWidthChange={(next) => {
				// A resize is a width choice: it ends the expanded state and
				// becomes the persisted width, so Expand never clobbers it.
				setExpanded(false);
				setWidth(next);
			}}
		>
			<DockedPanel.Chrome>
				<div class="flex min-w-0 flex-1 flex-wrap items-center gap-row">
					{props.title}
				</div>
				<IconButton
					label={expanded() ? "Shrink" : "Enlarge"}
					onClick={() => setExpanded((value) => !value)}
				>
					<Show when={expanded()} fallback={<MaximizeIcon />}>
						<MinimizeIcon />
					</Show>
				</IconButton>
				<IconButton label="Close" onClick={() => props.onClose()}>
					<CloseIcon />
				</IconButton>
			</DockedPanel.Chrome>
			<div class="flex min-h-0 flex-1 flex-col gap-stack overflow-hidden p-4">
				{props.children}
			</div>
		</DockedPanel>
	);
}

export function ChatDrawerTitle(props: { children: JSX.Element }) {
	return (
		<span class="truncate font-semibold text-h3 text-ink-1">
			{props.children}
		</span>
	);
}

// Helm pulls in no icon library, so the chrome glyphs are inline SVG.
function MaximizeIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<title>Enlarge</title>
			<path d="M15 3h6v6" />
			<path d="M9 21H3v-6" />
			<path d="M21 3l-7 7" />
			<path d="M3 21l7-7" />
		</svg>
	);
}

function MinimizeIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<title>Shrink</title>
			<path d="M4 14h6v6" />
			<path d="M20 10h-6V4" />
			<path d="M14 10l7-7" />
			<path d="M3 21l7-7" />
		</svg>
	);
}

function CloseIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<title>Close</title>
			<path d="M18 6 6 18" />
			<path d="m6 6 12 12" />
		</svg>
	);
}
