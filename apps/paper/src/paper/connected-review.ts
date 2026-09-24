import { requestVideoEvidence, type EvidenceObject } from "@vedaxi/contracts";
import type { FocusRequest, PublisherResult } from "@vedaxi/state";

export async function connectedReview(options: {
  paper: EvidenceObject; paperOrigin: string; videoOrigin: string;
  readVideo: () => Promise<EvidenceObject>; canContinue: () => boolean;
  propose: (request: FocusRequest) => PublisherResult;
}): Promise<{video: EvidenceObject; request: FocusRequest}> {
  if (!options.canContinue()) throw new Error("Publisher access is off");
  const video = await options.readVideo();
  if (!options.canContinue()) throw new Error("Publisher access changed; review cancelled");
  const paper = options.paper;
  if (paper.sourceOrigin !== options.paperOrigin || video.sourceOrigin !== options.videoOrigin || paper.sourceOrigin === video.sourceOrigin ||
      paper.id !== "paper.methods.final-analysis" || video.id !== "video.transcript.calibration-drift") throw new Error("Evidence origins or IDs do not match this review");
  // This is one bounded fictional-study comparison, not general scientific interpretation.
  const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  if (normalize(paper.excerpt) !== "forty participants completed the study and were included in the final analysis." ||
      normalize(video.excerpt) !== "we recruited forty participants. six sessions had calibration drift, so we removed them before modeling and did not replace them.") throw new Error("Returned evidence does not support the controlled comparison; human review required");
  const request: FocusRequest = {
    paperEvidenceId: "paper.methods.final-analysis", videoEvidenceId: "video.transcript.calibration-drift", analyzedSample: 34,
    reasoning: "The returned Video passage excludes six of forty participants; the Paper claims all forty in the final analysis.",
    provenance: {paper: `${paper.sourceOrigin} | ${paper.locator}`, video: `${video.sourceOrigin} | ${video.locator}`, derivation: "Controlled comparison of returned passages: 40 - 6 = 34"}
  };
  const result = options.propose(request);
  if (!result.ok) throw new Error("The publisher could not save the proposal; no successful handoff is claimed");
  return {video, request};
}
export { requestVideoEvidence };
