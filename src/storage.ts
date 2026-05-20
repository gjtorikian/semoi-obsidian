import { App, TFile } from "obsidian";
import type { MintResponse } from "./api";

// Frontmatter is nested under a single `semoi` key so we don't pollute top-level YAML.
export interface SemoiFrontmatter {
  proofId: string;
  verifyUrl: string;
  kid: string;
  contentHash: string;
  issuedAt: number;
}

export async function persistMint(app: App, file: TFile, result: MintResponse): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    const list = Array.isArray(fm.semoi) ? fm.semoi : fm.semoi ? [fm.semoi] : [];
    const entry: SemoiFrontmatter = {
      proofId: result.proofId,
      verifyUrl: result.verifyUrl,
      kid: result.proof.kid,
      contentHash: result.proof.claim.contentHash,
      issuedAt: result.proof.issuedAt,
    };
    list.push(entry);
    // Keep a single object when there's only one proof, otherwise an array.
    fm.semoi = list.length === 1 ? list[0] : list;
  });
}

export function readSemoiFrontmatter(app: App, file: TFile): SemoiFrontmatter | null {
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter as { semoi?: SemoiFrontmatter | SemoiFrontmatter[] } | undefined;
  if (!fm?.semoi) return null;
  if (Array.isArray(fm.semoi)) return fm.semoi[fm.semoi.length - 1] ?? null;
  return fm.semoi;
}

export async function forgetProof(app: App, file: TFile): Promise<boolean> {
  let hadProof = false;
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (fm.semoi != null) {
      hadProof = true;
      delete fm.semoi;
    }
  });
  return hadProof;
}
