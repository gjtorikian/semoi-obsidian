// Minimal stub of the `obsidian` runtime for unit tests. Only the surface
// area touched by the modules under test is implemented — extend as needed.

import { vi } from "vitest";

export const requestUrl = vi.fn();

export class TFile {
  path: string;
  basename: string;
  extension: string;
  constructor(path: string) {
    this.path = path;
    const slash = path.lastIndexOf("/");
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = name.lastIndexOf(".");
    this.basename = dot > 0 ? name.slice(0, dot) : name;
    this.extension = dot > 0 ? name.slice(dot + 1) : "";
  }
}

export type FrontMatterMutator = (fm: Record<string, unknown>) => void;

export interface FileCache {
  frontmatter?: Record<string, unknown>;
}

/**
 * Test double for Obsidian's `App`. Frontmatter is stored per-file in a Map and
 * mutated synchronously inside `processFrontMatter`, matching how the real
 * Obsidian API hands callers a draft object they can edit in place.
 */
export class App {
  private frontmatter = new Map<string, Record<string, unknown>>();

  fileManager = {
    processFrontMatter: async (file: TFile, fn: FrontMatterMutator): Promise<void> => {
      const current = this.frontmatter.get(file.path) ?? {};
      const draft = { ...current };
      fn(draft);
      this.frontmatter.set(file.path, draft);
    },
  };

  metadataCache = {
    getFileCache: (file: TFile): FileCache | null => {
      const fm = this.frontmatter.get(file.path);
      if (!fm) return null;
      return { frontmatter: fm };
    },
  };

  /** Test helper — seed frontmatter without going through processFrontMatter. */
  __setFrontmatter(file: TFile, fm: Record<string, unknown>): void {
    this.frontmatter.set(file.path, fm);
  }

  /** Test helper — inspect raw frontmatter state. */
  __getFrontmatter(file: TFile): Record<string, unknown> | undefined {
    return this.frontmatter.get(file.path);
  }
}
