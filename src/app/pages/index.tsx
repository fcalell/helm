import { Frame } from "@fcalell/plugin-solid-ui/components/frame";
import { createSignal, Match, Switch } from "solid-js";
import "../app.css";
import { BoardGrid } from "../components/board-grid.tsx";
import { BoardHeader } from "../components/board-header.tsx";
import { CardDrawer } from "../components/card-drawer.tsx";
import {
	DefineDrawer,
	type DefineTarget,
} from "../components/define-drawer.tsx";
import { InvalidBanner } from "../components/invalid-banner.tsx";
import { NewEpicDialog } from "../components/new-epic-dialog.tsx";
import {
	ShapingDrawer,
	type ShapingTarget,
} from "../components/shaping-drawer.tsx";
import { boardStore, connectBoard } from "../lib/board-store.ts";
import { connectGate } from "../lib/gate-store.ts";
import { connectMeter } from "../lib/meter-store.ts";
import { connectSessions } from "../lib/session-store.ts";

// The docked chat panel is a single region, so the page holds one selection:
// opening any chat surface replaces whichever one is showing.
type ChatSelection =
	| { kind: "story"; storyId: string }
	| { kind: "shaping"; target: ShapingTarget }
	| { kind: "define"; target: DefineTarget };

export default function Home() {
	const [selection, setSelection] = createSignal<ChatSelection | null>(null);
	const [drawerTab, setDrawerTab] = createSignal<string>();
	const [newEpicOpen, setNewEpicOpen] = createSignal(false);

	connectBoard();
	connectSessions();
	connectGate();
	connectMeter();

	function openStory(id: string): void {
		setDrawerTab(undefined);
		setSelection({ kind: "story", storyId: id });
	}

	const storySelection = () => {
		const active = selection();
		return active?.kind === "story" ? active : undefined;
	};
	const shapingSelection = () => {
		const active = selection();
		return active?.kind === "shaping" ? active : undefined;
	};
	const defineSelection = () => {
		const active = selection();
		return active?.kind === "define" ? active : undefined;
	};

	return (
		<Frame>
			<BoardHeader
				connected={boardStore.connected}
				onNewEpic={() => setNewEpicOpen(true)}
				onOpenShaping={(target) => setSelection({ kind: "shaping", target })}
			/>
			<InvalidBanner invalid={boardStore.invalid} />
			<div class="flex min-h-0 flex-1 overflow-hidden">
				<BoardGrid
					epics={boardStore.epics}
					stories={boardStore.stories}
					onOpen={openStory}
					onOpenEpicChat={(epicId) =>
						setSelection({ kind: "define", target: { epicId } })
					}
				/>
				<Switch>
					<Match when={storySelection()}>
						{(active) => (
							<CardDrawer
								story={boardStore.stories[active().storyId]}
								onClose={() => setSelection(null)}
								tab={drawerTab()}
								onTabChange={setDrawerTab}
							/>
						)}
					</Match>
					<Match when={shapingSelection()}>
						{(active) => (
							<ShapingDrawer
								target={active().target}
								onClose={() => setSelection(null)}
							/>
						)}
					</Match>
					<Match when={defineSelection()}>
						{(active) => (
							<DefineDrawer
								target={active().target}
								onClose={() => setSelection(null)}
							/>
						)}
					</Match>
				</Switch>
			</div>
			<NewEpicDialog
				open={newEpicOpen()}
				onOpenChange={setNewEpicOpen}
				onCreated={(target) => setSelection({ kind: "define", target })}
			/>
		</Frame>
	);
}
