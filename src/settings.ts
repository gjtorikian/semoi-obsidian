import { App, PluginSettingTab, Setting } from "obsidian";
import type SemoiPlugin from "./main";

export interface SemoiSettings {
  activeThresholdSeconds: number;
}

export const DEFAULT_SETTINGS: SemoiSettings = {
  activeThresholdSeconds: 5,
};

export class SemoiSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: SemoiPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Active typing threshold (seconds)")
      .setDesc(
        "Gaps between keystrokes shorter than this count toward active typing time; longer gaps are treated as you stepping away. Sessions are never rolled over by idleness — minting is always explicit.",
      )
      .addText((t) =>
        t
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.activeThresholdSeconds))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) {
              this.plugin.settings.activeThresholdSeconds = n;
              await this.plugin.saveSettings();
            }
          }),
      );
  }
}
