import {
	createPanelWidth,
	DockedPanel,
} from "@fcalell/plugin-solid-ui/components/docked-panel";
import { X } from "lucide-solid";
import type { JSX } from "solid-js";
import { IconButton } from "./icon-button.tsx";

// Helm's chat panel: a docked layout region beside the board, not a dialog,
// so no overlay, focus trap, or Escape dismiss; closing is the chrome button.
// It opens near full width and leaves a strip of board visible beside it;
// the drag handle is the one width control, and the dragged width persists
// (`createPanelWidth` re-reads localStorage on each mount).
const DEFAULT_SHARE = 0.9;
const MAX_SHARE = 0.95;

export function ChatDrawer(props: {
	title: JSX.Element;
	onClose: () => void;
	children: JSX.Element;
}) {
	// The panel mounts on a click, never in the server render, so the
	// viewport is measurable here.
	const viewport = window.innerWidth;
	const max = Math.round(viewport * MAX_SHARE);
	const [width, setWidth] = createPanelWidth({
		key: "helm.chat-panel-width",
		defaultWidth: Math.round(viewport * DEFAULT_SHARE),
	});

	return (
		<DockedPanel
			width={Math.min(width(), max)}
			maxWidth={max}
			onWidthChange={setWidth}
		>
			<DockedPanel.Chrome>
				<div class="flex min-w-0 flex-1 items-center gap-row">
					{props.title}
				</div>
				<IconButton label="Close" onClick={() => props.onClose()}>
					<X />
				</IconButton>
			</DockedPanel.Chrome>
			<div class="flex min-h-0 flex-1 flex-col gap-stack overflow-hidden p-gutter">
				{props.children}
			</div>
		</DockedPanel>
	);
}

export function ChatDrawerTitle(props: { children: JSX.Element }) {
	return (
		<span class="min-w-0 truncate font-semibold text-h3 text-ink-1">
			{props.children}
		</span>
	);
}
