import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { SemoiApi, type MintResponse, type VerifyResponse } from "../src/api";
import type { MintPayload } from "../src/session";

const requestUrlMock = vi.mocked(requestUrl);

function mockResponse(body: unknown, init: { status?: number; bodyIsText?: boolean } = {}) {
  const status = init.status ?? 200;
  if (init.bodyIsText) {
    return {
      status,
      text: body as string,
      json: undefined as unknown,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    };
  }
  return {
    status,
    text: JSON.stringify(body),
    json: body,
    headers: { "content-type": "application/json" },
    arrayBuffer: new ArrayBuffer(0),
  };
}

function samplePayload(): MintPayload {
  return {
    docId: "doc-1",
    startedAt: 1,
    endedAt: 2,
    activeMs: 1,
    events: [{ t: 0, k: "ins", n: 1 }],
    content: "hi",
    client: { name: "semoi-obsidian", version: "0.1.0" },
  };
}

function sampleMintResponse(): MintResponse {
  return {
    proofId: "proof-1",
    verifyUrl: "https://semoi.net/verify/proof-1",
    proof: {
      claim: {
        v: 1,
        docId: "doc-1",
        startedAt: 1,
        endedAt: 2,
        eventCount: 1,
        charCount: 2,
        contentHash: "sha256:abc",
        sessionHash: "sha256:def",
        client: { name: "semoi-obsidian", version: "0.1.0" },
      },
      issuedAt: 999,
      issuer: "semoi.net",
      kid: "key-1",
      pubkey: "pk",
      signature: "sig",
      proofId: "proof-1",
    },
  };
}

describe("SemoiApi", () => {
  beforeEach(() => {
    requestUrlMock.mockReset();
  });

  afterEach(() => {
    requestUrlMock.mockReset();
  });

  describe("mintProof", () => {
    it("POSTs JSON to /proof and returns the parsed response", async () => {
      const expected = sampleMintResponse();
      requestUrlMock.mockResolvedValueOnce(mockResponse(expected));
      const api = new SemoiApi("https://semoi.net");
      const result = await api.mintProof(samplePayload());

      expect(result).toEqual(expected);
      expect(requestUrlMock).toHaveBeenCalledTimes(1);
      const req = requestUrlMock.mock.calls[0][0];
      expect(req.url).toBe("https://semoi.net/proof");
      expect(req.method).toBe("POST");
      expect(req.headers!["content-type"]).toBe("application/json");
      expect(req.throw).toBe(false);
      expect(JSON.parse(req.body as string)).toEqual(samplePayload());
    });

    it("strips a trailing slash from the base URL", async () => {
      requestUrlMock.mockResolvedValueOnce(mockResponse(sampleMintResponse()));
      const api = new SemoiApi("https://semoi.net/");
      await api.mintProof(samplePayload());
      expect(requestUrlMock.mock.calls[0][0].url).toBe("https://semoi.net/proof");
    });

    it("strips multiple trailing slashes from the base URL", async () => {
      requestUrlMock.mockResolvedValueOnce(mockResponse(sampleMintResponse()));
      const api = new SemoiApi("https://semoi.net///");
      await api.mintProof(samplePayload());
      expect(requestUrlMock.mock.calls[0][0].url).toBe("https://semoi.net/proof");
    });

    it("throws with status and body on failure", async () => {
      requestUrlMock.mockResolvedValueOnce(mockResponse("boom", { status: 500, bodyIsText: true }));
      const api = new SemoiApi("https://semoi.net");
      await expect(api.mintProof(samplePayload())).rejects.toThrow("mintProof failed: 500 boom");
    });
  });

  describe("verifyProof", () => {
    it("GETs /api/verify/:id and returns the parsed response", async () => {
      const expected: VerifyResponse = {
        valid: true,
        keyStatus: "active",
        proof: sampleMintResponse().proof,
      };
      requestUrlMock.mockResolvedValueOnce(mockResponse(expected));
      const api = new SemoiApi("https://semoi.net");
      const result = await api.verifyProof("proof-1");

      expect(result).toEqual(expected);
      const req = requestUrlMock.mock.calls[0][0];
      expect(req.url).toBe("https://semoi.net/api/verify/proof-1");
      expect(req.method).toBeUndefined();
      expect(req.body).toBeUndefined();
    });

    it("URL-encodes the proof id to keep slashes and spaces safe", async () => {
      requestUrlMock.mockResolvedValueOnce(mockResponse({ valid: false, keyStatus: "unknown", proof: sampleMintResponse().proof }));
      const api = new SemoiApi("https://semoi.net");
      await api.verifyProof("weird id/with slash");
      expect(requestUrlMock.mock.calls[0][0].url).toBe("https://semoi.net/api/verify/weird%20id%2Fwith%20slash");
    });

    it("throws with status and body on failure", async () => {
      requestUrlMock.mockResolvedValueOnce(mockResponse("not found", { status: 404, bodyIsText: true }));
      const api = new SemoiApi("https://semoi.net");
      await expect(api.verifyProof("missing")).rejects.toThrow("verifyProof failed: 404 not found");
    });
  });
});
