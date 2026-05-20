import { MarkdownView, Notice, Platform, Plugin, TFile } from "obsidian";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { SemoiApi } from "./api";
import {
  buildMintPayload,
  ChangeAtom,
  SessionSnapshot,
  SessionTracker,
} from "./session";
import { forgetProof, persistMint, readSemoiFrontmatter } from "./storage";
import { DEFAULT_SETTINGS, SemoiSettings, SemoiSettingTab } from "./settings";

declare const __SEMOI_BACKEND__: string;

const CLIENT = { name: "semoi-obsidian", version: "0.1.0" };

export default class SemoiPlugin extends Plugin {
  settings: SemoiSettings = DEFAULT_SETTINGS;
  api!: SemoiApi;
  tracker!: SessionTracker;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.api = new SemoiApi(__SEMOI_BACKEND__);
    this.tracker = new SessionTracker({
      activeThresholdMs: this.settings.activeThresholdSeconds * 1000,
    });

    this.registerEditorExtension(this.buildEditorExtension());

    this.addSettingTab(new SemoiSettingTab(this.app, this));

    this.addCommand({
      id: "mint-current",
      name: "Mint proof for current note",
      checkCallback: (checking) => {
        if (!this.app.workspace.getActiveFile()) return false;
        if (!checking) void this.mintActive();
        return true;
      },
    });

    this.addCommand({
      id: "status-current",
      name: "Show proof status for current note",
      checkCallback: (checking) => {
        if (!this.app.workspace.getActiveFile()) return false;
        if (!checking) void this.statusActive();
        return true;
      },
    });

    this.addCommand({
      id: "reset-current",
      name: "Reset session for current note",
      checkCallback: (checking) => {
        if (!this.app.workspace.getActiveFile()) return false;
        if (!checking) this.resetActive();
        return true;
      },
    });

    this.addCommand({
      id: "forget-current",
      name: "Forget recorded proof for current note",
      checkCallback: (checking) => {
        if (!this.app.workspace.getActiveFile()) return false;
        if (!checking) void this.forgetActive();
        return true;
      },
    });

    // Sessions live until the user mints or resets them. Deletes drop the
    // in-memory buffer; renames carry it over to the new path so a rename
    // mid-session doesn't lose captured keystrokes.
    this.registerEvent(
      this.app.vault.on("delete", (f) => {
        if (f instanceof TFile) this.tracker.reset(f.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        if (f instanceof TFile) this.tracker.rename(oldPath, f.path);
      }),
    );
  }

  onunload(): void {
    // Registered events, editor extensions, and commands are auto-released by
    // the Plugin lifecycle. Drop the in-memory session map explicitly so any
    // captured event arrays are eligible for GC immediately on disable.
    this.tracker.clearAll();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.applyActiveThreshold();
  }

  applyActiveThreshold(): void {
    this.tracker.setActiveThreshold(this.settings.activeThresholdSeconds * 1000);
  }

  private buildEditorExtension() {
    return EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) return;

      const file = this.app.workspace.getActiveFile();
      if (!file) return;

      const atoms: ChangeAtom[] = [];
      update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        // ins/del/rep is derived purely from atom shape:
        //   removed>0 & inserted>0 -> rep
        //   inserted>0             -> ins
        //   removed>0              -> del
        // n = inserted length for ins/rep, removed length for del.
        atoms.push({
          insertedLength: inserted.length,
          removedLength: toA - fromA,
        });
      });
      if (atoms.length === 0) return;
      this.tracker.onChange(file.path, atoms);
    });
  }

  private getActiveFile(): TFile | null {
    return this.app.workspace.getActiveFile();
  }

  private getActiveContent(): string | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view ? view.editor.getValue() : null;
  }

  async mintActive(): Promise<void> {
    const file = this.getActiveFile();
    if (!file) return;
    const snapshot = this.tracker.finalize(file.path);
    if (!snapshot || snapshot.events.length === 0) {
      new Notice("Semoi: no keystroke evidence captured yet for this note");
      return;
    }
    const content = this.getActiveContent() ?? (await this.app.vault.cachedRead(file));
    await this.submit(file, snapshot, content);
  }

  private async submit(file: TFile, snapshot: SessionSnapshot, content: string): Promise<void> {
    try {
      const payload = buildMintPayload(snapshot, {
        docId: file.path,
        content,
        client: CLIENT,
      });
      new Notice("Semoi: minting proof…");
      const result = await this.api.mintProof(payload);
      await persistMint(this.app, file, result);
      const minutes = (snapshot.activeMs / 60_000).toFixed(1);
      new Notice(
        `Semoi: proof minted (${result.proofId.slice(0, 12)}…) — ${minutes} min active typing`,
      );
      if (result.verifyUrl && Platform.isDesktop) window.open(result.verifyUrl);
    } catch (err) {
      console.error("[semoi] mint failed", err);
      new Notice(`Semoi: mint failed — ${(err as Error).message}`);
    }
  }

  async statusActive(): Promise<void> {
    const file = this.getActiveFile();
    if (!file) return;
    const fm = readSemoiFrontmatter(this.app, file);
    if (!fm) {
      new Notice("Semoi: no proof recorded for this note");
      return;
    }
    try {
      const result = await this.api.verifyProof(fm.proofId);
      const verdict = result.valid ? "valid" : `INVALID (${result.reason ?? "unknown"})`;
      new Notice(`Semoi: ${verdict} — key ${result.keyStatus} — ${fm.proofId}`);
    } catch (err) {
      console.error("[semoi] verify failed", err);
      new Notice(`Semoi: verify failed — ${(err as Error).message}`);
    }
  }

  async forgetActive(): Promise<void> {
    const file = this.getActiveFile();
    if (!file) return;
    const hadProof = await forgetProof(this.app, file);
    new Notice(
      hadProof
        ? "Semoi: proof entry removed from this note"
        : "Semoi: no proof recorded for this note",
    );
  }

  resetActive(): void {
    const file = this.getActiveFile();
    if (!file) return;
    this.tracker.reset(file.path);
    new Notice("Semoi: session buffer cleared");
  }
}
