import { useEffect } from "react";
import { installVideoEvidenceResponder } from "@vedaxi/contracts";
import { createRoot } from "react-dom/client";
import { createVideoEvidenceService, createVideoFixture, createVideoSearchTool, createVideoTranscriptTool, resolveConfiguredPaperOrigin, resolveVideoRuntimeConfig } from "./video";
import { VideoApp } from "./video/VideoApp";
import type { VideoFixture } from "./video";
import { useVideoRegistration } from "./video/use-video-registration";
import { installVideoReadinessResponder } from "./video/readiness";
import "./styles.css";
const root = document.querySelector<HTMLElement>("#root"); if (!root) throw new Error("Video application root is missing");
let runtimeError: string | null = null;
let fixture: VideoFixture | null = null;
let paperOrigin: string | null = null;
try {
  const config = resolveVideoRuntimeConfig(
    window.location.origin,
    resolveConfiguredPaperOrigin(import.meta.env.VITE_PAPER_ORIGIN, import.meta.env.DEV)
  );
  fixture = createVideoFixture(config.videoOrigin);
  paperOrigin = config.paperOrigin;
} catch (error) {
  runtimeError = error instanceof Error ? error.message : "Video origin configuration is invalid";
}
if (runtimeError) {
  root.innerHTML = `<main role="alert"><h1>Video origin unavailable</h1><p>${runtimeError}. Transcript tools are not registered.</p></main>`;
} else {
  const service = createVideoEvidenceService(fixture!); const tools = [createVideoSearchTool(service), createVideoTranscriptTool(service)];
  function VideoRoot() { const protocol = useVideoRegistration(tools);
    useEffect(() => installVideoEvidenceResponder(window, paperOrigin!, () => service.readTranscript().evidence,
      () => protocol.status === "active" || protocol.status === "unsupported"), [protocol.status]);
    return <VideoApp fixture={fixture!} service={service} protocol={protocol} />; }
  createRoot(root).render(<VideoRoot />);
  installVideoReadinessResponder(paperOrigin!);
}
