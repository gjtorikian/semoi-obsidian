import { requestUrl } from "obsidian";
import type { MintPayload } from "./session";

export interface SignedProof {
  claim: {
    v: 1;
    docId: string;
    startedAt: number;
    endedAt: number;
    eventCount: number;
    charCount: number;
    contentHash: string;
    sessionHash: string;
    client: { name: string; version: string };
  };
  issuedAt: number;
  issuer: string;
  kid: string;
  pubkey: string;
  signature: string;
  proofId: string;
}

export interface MintResponse {
  proofId: string;
  proof: SignedProof;
  verifyUrl: string;
}

export interface VerifyResponse {
  valid: boolean;
  reason?: string;
  keyStatus: "active" | "retired" | "compromised" | "unknown";
  proof: SignedProof;
}

export class SemoiApi {
  constructor(private baseUrl: string) {}

  private url(path: string): string {
    const base = this.baseUrl.replace(/\/+$/, "");
    return `${base}${path}`;
  }

  async mintProof(payload: MintPayload): Promise<MintResponse> {
    const res = await requestUrl({
      url: this.url("/proof"),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`mintProof failed: ${res.status} ${res.text ?? ""}`);
    }
    return res.json as MintResponse;
  }

  async verifyProof(id: string): Promise<VerifyResponse> {
    const res = await requestUrl({
      url: this.url(`/api/verify/${encodeURIComponent(id)}`),
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`verifyProof failed: ${res.status} ${res.text ?? ""}`);
    }
    return res.json as VerifyResponse;
  }
}
