export { searchEvidence } from "./evidence";
export type { EvidenceObject, EvidenceSearchResult } from "./evidence";

export { registerWebMcpTools } from "./webmcp";
export type {
  ModelContextRegisterToolOptions,
  WebMcpRegistration,
  WebMcpRegistrationOptions,
  WebMcpRegistrationStatus,
  WebMcpTool,
  WebMcpUiStatus
} from "./webmcp";

export { requestVideoEvidence, installVideoEvidenceResponder } from "./evidence-bridge";
