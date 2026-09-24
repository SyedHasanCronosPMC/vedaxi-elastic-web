import type { EvidenceObject } from "./evidence";

const REQUEST = "vedaxi:transcript-request";
const RESPONSE = "vedaxi:transcript-response";
export function requestVideoEvidence(host: Window, remote: Window, origin: string, signal?: AbortSignal, timeoutMs = 8000): Promise<EvidenceObject> {
  const expected = new URL(origin).origin;
  if (expected === host.location.origin) return Promise.reject(new Error("An independent Video origin is required"));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { host.removeEventListener("message", receive); clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const fail = (message: string) => { cleanup(); reject(new Error(message)); };
    const abort = () => fail("Review cancelled because publisher access changed");
    const receive = (event: MessageEvent) => {
      if (event.source !== remote || event.origin !== expected || event.data?.type !== RESPONSE || event.data?.id !== id) return;
      if (event.data.error) return fail("Video publisher declined the evidence request");
      const e = event.data.evidence;
      if (!e || e.sourceOrigin !== expected || e.id !== "video.transcript.calibration-drift" || e.assetType !== "video-transcript" ||
          ![e.excerpt, e.locator, e.provenance, e.title].every(v => typeof v === "string" && v.length > 0 && v.length <= 10000)) return fail("Video evidence failed provenance validation");
      cleanup(); resolve(e);
    };
    if (signal?.aborted) return abort();
    host.addEventListener("message", receive);
    signal?.addEventListener("abort", abort, {once: true});
    timer = setTimeout(() => fail("Video publisher did not return evidence in time; no result was verified"), timeoutMs);
    try { remote.postMessage({type: REQUEST, version: 1, id}, expected); } catch { fail("Video publisher is unavailable"); }
  });
}

// Explicit browser bridge for the guided review, not an HTTP or native WebMCP transport.
// It exposes the same read-only publisher service and checks both sender window and origin.
export function installVideoEvidenceResponder(host: Window, paperOrigin: string, read: () => EvidenceObject, enabled: () => boolean): () => void {
  const expected = new URL(paperOrigin).origin;
  if (expected === host.location.origin || host.parent === host) return () => undefined;
  const receive = (event: MessageEvent) => {
    const d = event.data;
    if (event.origin !== expected || event.source !== host.parent || !d || d.type !== REQUEST || d.version !== 1 ||
        typeof d.id !== "string" || d.id.length > 80 || Object.keys(d).sort().join() !== "id,type,version") return;
    if (!enabled()) { host.parent.postMessage({type: RESPONSE, id: d.id, error: "publisher-disabled"}, expected); return; }
    host.parent.postMessage({type: RESPONSE, id: d.id, evidence: read()}, expected);
  };
  host.addEventListener("message", receive);
  return () => host.removeEventListener("message", receive);
}
