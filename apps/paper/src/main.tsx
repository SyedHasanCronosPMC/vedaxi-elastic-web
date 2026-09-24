import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { PublisherStorage } from "@vedaxi/state";

import { PaperApp } from "./paper/PaperApp";
import {
  createDiscrepancyFocusTool,
  createPaperCorpus,
  createPaperEvidenceService,
  createPaperEvidenceTool,
  createPaperFixture,
  resolveConfiguredVideoOrigin,
  resolvePaperRuntimeConfig
} from "./paper";
import { usePaperRegistration } from "./paper/use-paper-registration";
import { createPublisherRuntime } from "./stage/publisher-runtime";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#root");

if (!root) {
  throw new Error("Paper application root is missing");
}

const fixture = createPaperFixture(window.location.origin);
const paperCorpus = createPaperCorpus(fixture);
const service = createPaperEvidenceService(paperCorpus);
const unavailableStorage: PublisherStorage = {
  getItem: () => { throw new Error("localStorage unavailable"); },
  setItem: () => { throw new Error("localStorage unavailable"); }
};
let browserStorage: PublisherStorage;
try {
  browserStorage = window.localStorage;
} catch {
  browserStorage = unavailableStorage;
}
const publisherRuntime = createPublisherRuntime(browserStorage);
const paperEvidenceTool = createPaperEvidenceTool(service);
const focusTool = createDiscrepancyFocusTool(publisherRuntime.dispatch);
const tools = [paperEvidenceTool, focusTool] as const;
let videoOrigin: string | undefined;
let videoConfigurationError: string | null = null;
const rawVideoOrigin = import.meta.env.VITE_VIDEO_ORIGIN;
try {
  videoOrigin = resolvePaperRuntimeConfig(
    window.location.origin,
    resolveConfiguredVideoOrigin(rawVideoOrigin, import.meta.env.DEV)
  ).videoOrigin;
} catch (error) {
  videoConfigurationError = error instanceof Error
    ? error.message
    : "Video origin configuration is invalid";
}

function PaperRoot() {
  const protocol = usePaperRegistration(tools);
  const publisherView = useSyncExternalStore(
    publisherRuntime.subscribe,
    publisherRuntime.getSnapshot,
    publisherRuntime.getSnapshot
  );
  return <PaperApp
    fixture={fixture}
    service={service}
    protocol={protocol}
    publisherState={publisherView.state}
    dispatchPublisher={publisherRuntime.dispatch}
    publisherError={publisherView.error}
    videoOrigin={videoOrigin}
    videoConfigurationError={videoConfigurationError}
  />;
}

createRoot(root).render(<PaperRoot />);
