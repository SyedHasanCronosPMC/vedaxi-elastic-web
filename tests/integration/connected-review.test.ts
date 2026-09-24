import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublisherResult } from "@vedaxi/state";
import { requestVideoEvidence, installVideoEvidenceResponder } from "@vedaxi/contracts";
import { connectedReview } from "../../apps/paper/src/paper/connected-review";
import { createPaperFixture } from "../../apps/paper/src/paper/fixture";
import { createVideoFixture } from "../../apps/video/src/video/fixture";

const paperOrigin = "https://paper.example.test", videoOrigin = "https://video.example.test";
const evidence = createVideoFixture(videoOrigin).evidence;
function bus(origin = paperOrigin) {
  const listeners = new Set<(e: MessageEvent) => void>();
  const host = {location: {origin}, addEventListener: (_: string, cb: any) => listeners.add(cb), removeEventListener: (_: string, cb: any) => listeners.delete(cb)} as unknown as Window;
  const emit = (data: unknown, source: unknown, origin = videoOrigin) => listeners.forEach(cb => cb({data, source, origin} as MessageEvent));
  return {host, emit, listeners};
}
afterEach(() => vi.useRealTimers());
describe("independent publisher evidence bridge", () => {
  it("waits for and returns the independent publisher's passage", async () => {
    const b = bus(); const remote = {postMessage: vi.fn()} as unknown as Window;
    const pending = requestVideoEvidence(b.host, remote, videoOrigin);
    const req = vi.mocked(remote.postMessage).mock.calls[0][0] as any;
    b.emit({type: "vedaxi:transcript-response", id: req.id, evidence}, remote);
    expect(await pending).toEqual(evidence); expect(b.listeners.size).toBe(0);
  });
  it.each(["wrong-origin", "wrong-window", "wrong-id", "no-reply"])("does not verify %s", async mode => {
    vi.useFakeTimers(); const b = bus(); const remote = {postMessage: vi.fn()} as unknown as Window;
    const pending = requestVideoEvidence(b.host, remote, videoOrigin, undefined, 50);
    const failure = expect(pending).rejects.toThrow("did not return evidence");
    const req = vi.mocked(remote.postMessage).mock.calls[0][0] as any;
    if (mode !== "no-reply") b.emit({type: "vedaxi:transcript-response", id: mode === "wrong-id" ? "old" : req.id, evidence}, mode === "wrong-window" ? {} : remote, mode === "wrong-origin" ? "https://other.test" : videoOrigin);
    await vi.advanceTimersByTimeAsync(51); await failure; expect(b.listeners.size).toBe(0);
  });
  it.each(["malformed", "revoked"])("rejects a %s response", async mode => {
    const b = bus(); const remote = {postMessage: vi.fn()} as unknown as Window;
    const pending = requestVideoEvidence(b.host, remote, videoOrigin);
    const failure = expect(pending).rejects.toThrow();
    const req = vi.mocked(remote.postMessage).mock.calls[0][0] as any;
    b.emit({type: "vedaxi:transcript-response", id: req.id, ...(mode === "revoked" ? {error: "off"} : {evidence: {...evidence, sourceOrigin: paperOrigin}})}, remote);
    await failure;
  });
  it("cancels pending evidence when access is revoked", async () => {
    const b = bus(); const remote = {postMessage: vi.fn()} as unknown as Window; const controller = new AbortController();
    const pending = requestVideoEvidence(b.host, remote, videoOrigin, controller.signal);
    const failure = expect(pending).rejects.toThrow("cancelled"); controller.abort(); await failure; expect(b.listeners.size).toBe(0);
  });
  it("responder validates the parent and origin and respects its own off switch", () => {
    const b = bus(videoOrigin); const parent = {postMessage: vi.fn()}; Object.assign(b.host, {parent}); let enabled = true;
    const read = vi.fn(() => evidence);
    const stop = installVideoEvidenceResponder(b.host, paperOrigin, read, () => enabled);
    const req = {type: "vedaxi:transcript-request", version: 1, id: "test-1"};
    b.emit(req, {}, paperOrigin); b.emit(req, parent, "https://evil.test"); expect(read).not.toHaveBeenCalled();
    b.emit(req, parent, paperOrigin); expect(read).toHaveBeenCalledTimes(1); expect(parent.postMessage).toHaveBeenLastCalledWith({type: "vedaxi:transcript-response", id: "test-1", evidence}, paperOrigin);
    enabled = false; b.emit(req, parent, paperOrigin); expect(read).toHaveBeenCalledTimes(1); expect(parent.postMessage).toHaveBeenLastCalledWith({type: "vedaxi:transcript-response", id: "test-1", error: "publisher-disabled"}, paperOrigin);
    stop(); expect(b.listeners.size).toBe(0);
  });
});
const setup = () => ({paper: createPaperFixture(paperOrigin).evidence, paperOrigin, videoOrigin, readVideo: vi.fn(async () => evidence), canContinue: () => true, propose: vi.fn((): PublisherResult => ({ok: true, state: {citationStatus: "unblocked", focusProposal: null, discrepancyNote: null, auditEvents: []}}))});
describe("connected review decision boundary", () => {
  it("proposes only after receiving video evidence and retains both origins", async () => {
    const options = setup(); const result = await connectedReview(options);
    expect(result.request.analyzedSample).toBe(34); expect(result.request.provenance.video).toContain(videoOrigin); expect(result.request.provenance.paper).toContain(paperOrigin); expect(options.propose).toHaveBeenCalledOnce();
  });
  it("does not propose when video fails", async () => {
    const options = setup(); options.readVideo.mockRejectedValue(new Error("offline"));
    await expect(connectedReview(options)).rejects.toThrow("offline"); expect(options.propose).not.toHaveBeenCalled();
  });
  it("does not propose after revocation during execution", async () => {
    const options = setup(); options.canContinue = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    await expect(connectedReview(options)).rejects.toThrow("cancelled"); expect(options.propose).not.toHaveBeenCalled();
  });
  it.each(["origin", "excerpt", "correction"])("rejects mismatched %s instead of deriving a canned success", async kind => {
    const options = setup(); options.readVideo.mockResolvedValue({...evidence, ...(kind === "origin" ? {sourceOrigin: "https://untrusted.test"} : {excerpt: kind === "correction" ? evidence.excerpt + " Correction: all sessions were reinstated." : "The study changed; twelve were excluded."})});
    await expect(connectedReview(options)).rejects.toThrow(); expect(options.propose).not.toHaveBeenCalled();
  });
  it("does not claim success when proposal persistence fails", async () => {
    const options = setup(); const failed = {...options, propose: vi.fn(() => ({ok: false, code: "persistence-failed", recoverable: true} as const))};
    await expect(connectedReview(failed as Parameters<typeof connectedReview>[0])).rejects.toThrow("could not save");
  });
});
