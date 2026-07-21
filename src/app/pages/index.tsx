import { createSignal } from "solid-js";
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
import { connectSessions, spawnRefineSession } from "../lib/session-store.ts";

export default function Home() {
	const [selectedStoryId, setSelectedStoryId] = createSignal<string | null>(
		null,
	);
	const [drawerOpen, setDrawerOpen] = createSignal(false);
	const [drawerTab, setDrawerTab] = createSignal<string>();
	const [epicView, setEpicView] = createSignal(false);
	const [shapingTarget, setShapingTarget] = createSignal<ShapingTarget | null>(
		null,
	);
	const [defineTarget, setDefineTarget] = createSignal<DefineTarget | null>(
		null,
	);
	const [newEpicOpen, setNewEpicOpen] = createSignal(false);

	connectBoard();
	connectSessions();
	connectGate();
	connectMeter();

	function openStory(id: string): void {
		setSelectedStoryId(id);
		setDrawerTab(undefined);
		setDrawerOpen(true);
	}

	function refineStory(id: string): void {
		const story = boardStore.stories[id];
		if (!story) return;
		const status = story.frontmatter.status;
		if (status !== "backlog" && status !== "refining") return;
		setSelectedStoryId(id);
		setDrawerTab("chat");
		setDrawerOpen(true);
		if (
			status === "backlog" &&
			story.frontmatter.sessions.refine === undefined
		) {
			void spawnRefineSession(id);
		}
	}

	const selectedStory = () => {
		const id = selectedStoryId();
		return id ? boardStore.stories[id] : undefined;
	};

	return (
		<div class="flex h-screen flex-col overflow-hidden bg-background text-foreground">
			<BoardHeader
				connected={boardStore.connected}
				epicView={epicView()}
				onToggleEpicView={() => setEpicView((value) => !value)}
				onNewEpic={() => setNewEpicOpen(true)}
				onOpenShaping={setShapingTarget}
			/>
			<InvalidBanner invalid={boardStore.invalid} />
			<BoardGrid
				epics={boardStore.epics}
				stories={boardStore.stories}
				epicView={epicView()}
				onOpen={openStory}
				onRefine={refineStory}
				onOpenEpicChat={(epicId) => setDefineTarget({ epicId })}
			/>
			<CardDrawer
				story={selectedStory()}
				open={drawerOpen()}
				onOpenChange={setDrawerOpen}
				tab={drawerTab()}
				onTabChange={setDrawerTab}
			/>
			<ShapingDrawer
				target={shapingTarget()}
				onOpenChange={(open) => {
					if (!open) setShapingTarget(null);
				}}
			/>
			<DefineDrawer
				target={defineTarget()}
				onOpenChange={(open) => {
					if (!open) setDefineTarget(null);
				}}
			/>
			<NewEpicDialog
				open={newEpicOpen()}
				onOpenChange={setNewEpicOpen}
				onCreated={setDefineTarget}
			/>
		</div>
	);
}
