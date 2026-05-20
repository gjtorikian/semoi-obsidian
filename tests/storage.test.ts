import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import type { App as ObsidianApp } from "obsidian";
import { forgetProof, persistMint, readSemoiFrontmatter } from "../src/storage";
import type { MintResponse, SignedProof } from "../src/api";
import type { SemoiFrontmatter } from "../src/storage";

function buildMintResponse(overrides: Partial<SignedProof["claim"]> = {}): MintResponse {
  const claim: SignedProof["claim"] = {
    v: 1,
    docId: "doc-1",
    startedAt: 1,
    endedAt: 2,
    eventCount: 3,
    charCount: 4,
    contentHash: "sha256:abc",
    sessionHash: "sha256:def",
    client: { name: "semoi-obsidian", version: "0.1.0" },
    ...overrides,
  };
  return {
    proofId: "proof-1",
    verifyUrl: "https://semoi.net/verify/proof-1",
    proof: {
      claim,
      issuedAt: 999,
      issuer: "semoi.net",
      kid: "key-1",
      pubkey: "pk",
      signature: "sig",
      proofId: "proof-1",
    },
  };
}

function entry(p: Partial<SemoiFrontmatter> = {}): SemoiFrontmatter {
  return {
    proofId: "proof-x",
    verifyUrl: "https://semoi.net/verify/proof-x",
    kid: "key-x",
    contentHash: "sha256:x",
    issuedAt: 0,
    ...p,
  };
}

describe("persistMint", () => {
  it("writes a single object when no prior proof exists", async () => {
    const app = new App();
    const file = new TFile("note.md");
    await persistMint(app as unknown as ObsidianApp, file, buildMintResponse());
    const fm = app.__getFrontmatter(file)!;
    expect(fm.semoi).toEqual({
      proofId: "proof-1",
      verifyUrl: "https://semoi.net/verify/proof-1",
      kid: "key-1",
      contentHash: "sha256:abc",
      issuedAt: 999,
    });
  });

  it("promotes a single existing object into an array of two on second mint", async () => {
    const app = new App();
    const file = new TFile("note.md");
    app.__setFrontmatter(file, { semoi: entry({ proofId: "old" }) });
    await persistMint(app as unknown as ObsidianApp, file, buildMintResponse());
    const fm = app.__getFrontmatter(file)!;
    expect(Array.isArray(fm.semoi)).toBe(true);
    const list = fm.semoi as SemoiFrontmatter[];
    expect(list).toHaveLength(2);
    expect(list[0].proofId).toBe("old");
    expect(list[1].proofId).toBe("proof-1");
  });

  it("appends to an existing array of proofs", async () => {
    const app = new App();
    const file = new TFile("note.md");
    app.__setFrontmatter(file, {
      semoi: [entry({ proofId: "p1" }), entry({ proofId: "p2" })],
    });
    await persistMint(app as unknown as ObsidianApp, file, buildMintResponse());
    const list = app.__getFrontmatter(file)!.semoi as SemoiFrontmatter[];
    expect(list.map((e) => e.proofId)).toEqual(["p1", "p2", "proof-1"]);
  });

  it("does not disturb unrelated frontmatter keys", async () => {
    const app = new App();
    const file = new TFile("note.md");
    app.__setFrontmatter(file, { tags: ["draft"], title: "Hello" });
    await persistMint(app as unknown as ObsidianApp, file, buildMintResponse());
    const fm = app.__getFrontmatter(file)!;
    expect(fm.tags).toEqual(["draft"]);
    expect(fm.title).toBe("Hello");
    expect(fm.semoi).toBeDefined();
  });
});

describe("readSemoiFrontmatter", () => {
  it("returns null when the file has no cached frontmatter", () => {
    const app = new App();
    const file = new TFile("note.md");
    expect(readSemoiFrontmatter(app as unknown as ObsidianApp, file)).toBeNull();
  });

  it("returns null when the semoi key is missing", () => {
    const app = new App();
    const file = new TFile("note.md");
    app.__setFrontmatter(file, { tags: ["draft"] });
    expect(readSemoiFrontmatter(app as unknown as ObsidianApp, file)).toBeNull();
  });

  it("returns the single object form unchanged", () => {
    const app = new App();
    const file = new TFile("note.md");
    const e = entry({ proofId: "only" });
    app.__setFrontmatter(file, { semoi: e });
    expect(readSemoiFrontmatter(app as unknown as ObsidianApp, file)).toEqual(e);
  });

  it("returns the last entry when frontmatter holds an array", () => {
    const app = new App();
    const file = new TFile("note.md");
    app.__setFrontmatter(file, {
      semoi: [entry({ proofId: "first" }), entry({ proofId: "last" })],
    });
    expect(readSemoiFrontmatter(app as unknown as ObsidianApp, file)?.proofId).toBe("last");
  });

  it("returns null for an empty array (no proofs recorded)", () => {
    const app = new App();
    const file = new TFile("note.md");
    app.__setFrontmatter(file, { semoi: [] });
    expect(readSemoiFrontmatter(app as unknown as ObsidianApp, file)).toBeNull();
  });
});

describe("forgetProof", () => {
  it("removes the semoi key and reports true when it existed", async () => {
    const app = new App();
    const file = new TFile("note.md");
    app.__setFrontmatter(file, { semoi: entry(), tags: ["draft"] });
    const had = await forgetProof(app as unknown as ObsidianApp, file);
    expect(had).toBe(true);
    const fm = app.__getFrontmatter(file)!;
    expect(fm.semoi).toBeUndefined();
    expect(fm.tags).toEqual(["draft"]);
  });

  it("reports true and clears when semoi was an array", async () => {
    const app = new App();
    const file = new TFile("note.md");
    app.__setFrontmatter(file, { semoi: [entry(), entry()] });
    const had = await forgetProof(app as unknown as ObsidianApp, file);
    expect(had).toBe(true);
    expect(app.__getFrontmatter(file)!.semoi).toBeUndefined();
  });

  it("returns false when no semoi key was present", async () => {
    const app = new App();
    const file = new TFile("note.md");
    app.__setFrontmatter(file, { tags: ["draft"] });
    const had = await forgetProof(app as unknown as ObsidianApp, file);
    expect(had).toBe(false);
  });

  it("returns false when frontmatter is entirely empty", async () => {
    const app = new App();
    const file = new TFile("note.md");
    const had = await forgetProof(app as unknown as ObsidianApp, file);
    expect(had).toBe(false);
  });
});
