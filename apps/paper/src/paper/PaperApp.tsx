import { connectedReview, requestVideoEvidence } from "./connected-review";
import { type FormEvent, useEffect, useReducer, useRef, useState } from "react";

import type { EvidenceSearchResult } from "@vedaxi/contracts";
import type {
  FocusRequest,
  PublisherAction,
  PublisherResult,
  PublisherState
} from "@vedaxi/state";

import { EditionWorld } from "../stage/EditionWorld";
import { ProtocolStage3D } from "../stage/ProtocolStage3D";
import {
  STAGE_CHAPTERS,
  StageNavigation,
  selectActiveChapter,
  stageChapterFromHash,
  type StageChapterId
} from "../stage/StageNavigation";

import {
  confirmFocusAction,
  rejectFocusAction,
  requestFocusAction,
  resetPublisherAction
} from "../actions";
import type { PaperFixture } from "./fixture";
import { protocolStatusCopy } from "./protocol-status";
import type { PaperEvidenceService } from "./service";
import type { PaperProtocolControls } from "./use-paper-registration";

export interface PaperAppProps {
  fixture: PaperFixture;
  service: PaperEvidenceService;
  protocol: PaperProtocolControls;
  publisherState?: PublisherState;
  dispatchPublisher?: (action: PublisherAction) => PublisherResult;
  publisherError?: string | null;
  videoOrigin?: string;
  videoConfigurationError?: string | null;
}

const VIDEO_READY_REQUEST = { type: "vedaxi:video-readiness-request", version: 1 } as const;
const VIDEO_READY_RESPONSE = { type: "vedaxi:video-readiness", version: 1 } as const;
const VIDEO_READY_TIMEOUT_MS = 5_000;

function normalizedHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function normalizedIndependentVideoOrigin(videoOrigin: string, paperOrigin: string | null): string | null {
  const normalizedVideo = normalizedHttpOrigin(videoOrigin);
  if (!normalizedVideo) return null;
  if (paperOrigin === null) return normalizedVideo;
  const normalizedPaper = normalizedHttpOrigin(paperOrigin);
  return normalizedPaper && normalizedPaper !== normalizedVideo ? normalizedVideo : null;
}

function exactReadyPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return Object.keys(fields).length === 2 &&
    fields.type === VIDEO_READY_RESPONSE.type &&
    fields.version === VIDEO_READY_RESPONSE.version;
}

export function monitorVideoReadiness(
  windowRef: Window,
  videoOrigin: string,
  videoWindow: MessageEventSource,
  onResult: (available: boolean) => void,
  timeoutMs = VIDEO_READY_TIMEOUT_MS
): () => void {
  const expectedOrigin = normalizedIndependentVideoOrigin(videoOrigin, windowRef.location.origin);
  if (!expectedOrigin) {
    onResult(false);
    return () => undefined;
  }

  let settled = false;
  let timer = 0;
  const remove = () => {
    windowRef.removeEventListener("message", onMessage);
    windowRef.clearTimeout(timer);
  };
  const finish = (available: boolean) => {
    if (settled) return;
    settled = true;
    remove();
    onResult(available);
  };
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== expectedOrigin || event.source !== videoWindow || !exactReadyPayload(event.data)) return;
    finish(true);
  };

  windowRef.addEventListener("message", onMessage);
  timer = windowRef.setTimeout(() => finish(false), timeoutMs);
  return () => {
    settled = true;
    remove();
  };
}

export function requestVideoReadiness(videoWindow: Window, videoOrigin: string): boolean {
  const targetOrigin = normalizedHttpOrigin(videoOrigin);
  if (!targetOrigin) return false;
  try {
    videoWindow.postMessage(VIDEO_READY_REQUEST, targetOrigin);
    return true;
  } catch {
    return false;
  }
}

export function startVideoReadinessAttempt(
  windowRef: Window,
  videoOrigin: string,
  videoWindow: Window,
  onResult: (available: boolean) => void,
  timeoutMs = VIDEO_READY_TIMEOUT_MS
): () => void {
  const expectedOrigin = normalizedIndependentVideoOrigin(videoOrigin, windowRef.location.origin);
  if (!expectedOrigin) {
    onResult(false);
    return () => undefined;
  }
  const cleanup = monitorVideoReadiness(windowRef, expectedOrigin, videoWindow, onResult, timeoutMs);
  if (!requestVideoReadiness(videoWindow, expectedOrigin)) {
    cleanup();
    onResult(false);
  }
  return cleanup;
}

interface VideoReadinessState {
  origin: string | null;
  available: boolean | null;
}

interface VideoReadinessAttempt {
  origin: string;
  generation: number;
  cleanup: () => void;
}

interface VideoReadinessAttemptRef {
  current: VideoReadinessAttempt | null;
}

export function cleanupVideoReadinessAttempt(
  attemptRef: VideoReadinessAttemptRef,
  origin?: string
): void {
  const attempt = attemptRef.current;
  if (!attempt || (origin !== undefined && attempt.origin !== origin)) return;
  attemptRef.current = null;
  attempt.cleanup();
}

export function videoAvailabilityForOrigin(
  readiness: VideoReadinessState,
  currentOrigin: string | null
): boolean | null {
  if (!currentOrigin) return false;
  return readiness.origin === currentOrigin ? readiness.available : null;
}

export const CONTROLLED_FOCUS_REQUEST: FocusRequest = {
  paperEvidenceId: "paper.methods.final-analysis",
  videoEvidenceId: "video.transcript.calibration-drift",
  analyzedSample: 34,
  reasoning: "The video excludes six of the paper's forty reported participants.",
  provenance: {
    paper: "VEDAXI controlled paper fixture — Methods, participants",
    video: "VEDAXI controlled video fixture — transcript cue at 00:03:12",
    derivation: "Externally supplied comparison: 40 - 6 = 34"
  }
};

const EMPTY_PUBLISHER_STATE: PublisherState = {
  citationStatus: "unblocked",
  discrepancyNote: null,
  focusProposal: null,
  auditEvents: []
};

function localPublisherReducer(state: PublisherState, action: PublisherAction): PublisherState {
  if (action.type === "request-focus") {
    return {
      ...state,
      focusProposal: action.request,
      auditEvents: [...state.auditEvents, { type: "focus-requested" }]
    };
  }
  if (action.type === "confirm-focus") {
    if (!state.focusProposal) return state;
    return {
      citationStatus: "blocked",
      focusProposal: null,
      discrepancyNote: { id: "discrepancy-note-1", ...state.focusProposal },
      auditEvents: [...state.auditEvents, { type: "focus-confirmed", confirmedBy: action.confirmation.confirmedBy }]
    };
  }
  if (action.type === "reject-focus") {
    return {
      ...state,
      focusProposal: null,
      auditEvents: [...state.auditEvents, { type: "focus-rejected" }]
    };
  }
  if (action.type === "reset") {
    return EMPTY_PUBLISHER_STATE;
  }
  return state;
}

function reviewHistoryCopy(event: PublisherState["auditEvents"][number]): string {
  switch (event.type) {
    case "focus-requested":
      return "Focus requested";
    case "focus-rejected":
      return "Focus rejected";
    case "focus-confirmed":
      return "Citation block confirmed by human";
  }
}

function ProtocolStatus({
  protocol,
  service
}: {
  protocol: PaperProtocolControls;
  service: PaperEvidenceService;
}) {
  const isActive = protocol.status === "active";
  const isChecking = protocol.status === "checking";
  const [simulationLog, setSimulationLog] = useState<{
    ok: boolean;
    query: string;
    message: string;
    timestamp: string;
  } | null>(null);

  const simulateAgentCall = () => {
    const query = "final analyzed sample";
    const timestamp = new Date().toLocaleTimeString();
    if (protocol.status !== "active") {
      setSimulationLog({
        ok: false,
        query,
        message: `Local diagnostic not run: native registration is ${protocol.status}. No HTTP request was sent.`,
        timestamp
      });
    } else {
      const results = service.search(query);
      setSimulationLog({
        ok: true,
        query,
        message: `Local evidence service returned: "${results[0]?.evidence.excerpt ?? "Evidence found"}"`,
        timestamp
      });
    }
  };

  return (
    <section className="protocol" aria-labelledby="protocol-title">
      <div>
        <p className="eyebrow" id="protocol-title">Native protocol</p>
        <p className="protocol__status" data-status={protocol.status} aria-live="polite">
          <span aria-hidden="true" className="protocol__marker" />
          {protocolStatusCopy(protocol.status)}
        </p>
      </div>

      <div className="protocol__surface">
        <p className="protocol__surface-label mono">
          {isActive ? "Exposed WebMCP Tools (2)" : protocol.status === "disabled" ? "Exposed WebMCP Tools (0 — Revoked)" : `Exposed WebMCP Tools (0 — ${protocol.status})`}
        </p>
        <ul className="protocol__tool-list" aria-label="Live WebMCP tools">
          <li className={isActive ? "tool-active" : "tool-revoked"}>
            <code>search_paper_evidence</code>
            <span className="tool-badge">{isActive ? "active" : "withdrawn"}</span>
          </li>
          <li className={isActive ? "tool-active" : "tool-revoked"}>
            <code>request_discrepancy_focus</code>
            <span className="tool-badge">{isActive ? "active" : "withdrawn"}</span>
          </li>
        </ul>
      </div>

      <div className="protocol__actions">
        <button
          className="text-button"
          type="button"
          disabled={isChecking}
          onClick={isActive ? protocol.disable : protocol.enable}
        >
          {isChecking ? "Checking…" : isActive ? "Turn agent tools off" : "Check native tools"}
        </button>

        <button
          className="protocol__probe-btn"
          type="button"
          onClick={simulateAgentCall}
        >
          <span>▶ Run local service diagnostic</span>
        </button>
      </div>

      {simulationLog && (
        <div
          className={`protocol__probe-result ${simulationLog.ok ? "probe-success" : "probe-blocked"}`}
          role="status"
          aria-live="polite"
        >
          <div className="probe-result__header mono">
            <span>[Agent Probe at {simulationLog.timestamp}]</span>
            <span>Query: &ldquo;{simulationLog.query}&rdquo;</span>
          </div>
          <p className="probe-result__body">{simulationLog.message}</p>
        </div>
      )}
    </section>
  );
}

function getEvidenceAnchor(locator: string): string {
  const lower = locator.toLowerCase();
  if (lower.includes("abstract")) return "#abstract";
  if (lower.includes("flow")) return "#study-flow";
  if (lower.includes("limitation")) return "#limitations";
  if (lower.includes("reference")) return "#references";
  if (lower.includes("participants")) return "#methods-participants";
  if (lower.includes("methods")) return "#methods";
  return "#methods-participants";
}

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return text;
  const regex = new RegExp(`(${terms.join("|")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="search-match">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function PaperSearch({ service }: { service: PaperEvidenceService }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EvidenceSearchResult[] | null>(null);
  const [focusResult, setFocusResult] = useState(false);
  const firstResultRef = useRef<HTMLAnchorElement>(null);

  const suggestions = [
    "final analyzed sample",
    "forty participants",
    "included in the final analysis"
  ] as const;

  const runSearch = (nextQuery: string, shouldFocusResult = false) => {
    setQuery(nextQuery);
    setResults(service.search(nextQuery));
    setFocusResult(shouldFocusResult);
  };

  useEffect(() => {
    if (!focusResult || results === null) return;
    const resultLink = firstResultRef.current;
    const targetId = resultLink?.hash.slice(1);
    const target = targetId ? document.getElementById(targetId) : null;

    if (target && targetId) {
      window.location.hash = targetId;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center" });
    } else {
      resultLink?.focus();
    }
    setFocusResult(false);
  }, [focusResult, results]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runSearch(query);
  };

  const message =
    results === null
      ? "Search the publisher’s paper evidence."
      : results.length === 0
        ? "No matching paper evidence."
        : `${results.length} matching paper passage found for “${query}”.`;

  return (
    <section className="paper-search" aria-labelledby="paper-search-title">
      <form className="search-form" onSubmit={submit}>
        <label htmlFor="paper-query">Paper evidence query</label>
        <div className="search-form__controls">
          <input
            id="paper-query"
            name="query"
            maxLength={160}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try “final analyzed sample”"
          />
          <button type="submit">
            <svg
              aria-hidden="true"
              className="search-icon"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              focusable="false"
            >
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            </svg>
            <span>Search</span>
          </button>
        </div>
      </form>
      <div className="search-suggestions" aria-label="Suggested paper searches">
        <span>Try one:</span>
        {suggestions.map((suggestion) => (
          <button
            aria-pressed={results !== null && query === suggestion}
            key={suggestion}
            type="button"
            onClick={() => runSearch(suggestion, true)}
          >
            {suggestion}
          </button>
        ))}
      </div>
      <div className="paper-search__heading">
        <div>
          <p className="eyebrow">Human research path</p>
          <h2 id="paper-search-title">Search this paper</h2>
        </div>
        <p className="paper-search__hint">Works independently of native agent tools.</p>
      </div>
      <p className="search-message" aria-live="polite">{message}</p>
      {results?.map(({ evidence, score }, index) => (
        <a
          className="search-result"
          href={getEvidenceAnchor(evidence.locator)}
          key={evidence.id}
          ref={index === 0 ? firstResultRef : undefined}
          onClick={() => {
            const target = document.getElementById("methods-participants") || document.getElementById("chapter-evidence");
            target?.scrollIntoView({ behavior: "smooth", block: "center" });
            target?.focus();
          }}
        >
          <div className="search-result__header">
            <span className="search-result__title">{evidence.title}</span>
            <span className="mono search-result__locator">{evidence.locator} · {score} exact query terms</span>
          </div>
          <blockquote className="search-result__excerpt">
            <p>{highlightMatch(evidence.excerpt, query)}</p>
          </blockquote>
          <div className="search-result__meta mono">
            <span>Origin: {evidence.sourceOrigin}</span>
            <span className="search-result__open-cue">Inspect evidence card →</span>
          </div>
        </a>
      ))}
    </section>
  );
}

interface ExecutionStep {
  id: string;
  kind: "query-paper" | "query-video" | "derivation" | "stage-focus" | "fail-closed";
  title: string;
  detail: string;
  status: "pending" | "running" | "success" | "blocked";
}

export function PaperApp({
  fixture,
  service,
  protocol,
  publisherState = EMPTY_PUBLISHER_STATE,
  dispatchPublisher = () => ({ ok: false, code: "invalid-action", recoverable: true }),
  publisherError = null,
  videoOrigin = "",
  videoConfigurationError = null
}: PaperAppProps) {
  const { document: paper, evidence } = fixture;
  const normalizedVideoOrigin = normalizedIndependentVideoOrigin(
    videoOrigin,
    typeof window === "undefined" ? null : window.location.origin
  );
  const [activeStageChapter, setActiveStageChapter] = useState<StageChapterId>(() =>
    stageChapterFromHash(typeof window === "undefined" ? "" : window.location.hash)
  );
  const [videoReadiness, setVideoReadiness] = useState<VideoReadinessState>({
    origin: normalizedVideoOrigin,
    available: normalizedVideoOrigin ? null : false
  });
  const videoAvailable = videoAvailabilityForOrigin(videoReadiness, normalizedVideoOrigin);
  const videoFrameRef = useRef<HTMLIFrameElement>(null);
  const readinessAttemptRef = useRef<VideoReadinessAttempt | null>(null);
  const readinessGenerationRef = useRef(0);
  const [stageRestored, setStageRestored] = useState(false);
  const focus = publisherState.focusProposal ?? publisherState.discrepancyNote;
  const hasFocus = focus !== null;
  const focusActive = hasFocus && !stageRestored;

  const [prompt, setPrompt] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionTrace, setExecutionTrace] = useState<ExecutionStep[] | null>(null);
  const isProtocolDisabled = protocol.status === "disabled" || protocol.status === "error";

  const [synthesisResult, setSynthesisResult] = useState<{
    mode: "augmented" | "revoked";
    title: string;
    finding: string;
    details: string;
  } | null>(null);

  const presets = [
    "Compare participant cohort between paper and author video",
    "Check if any enrolled sessions were excluded for calibration drift",
    "Derive final analyzed sample size across origins"
  ] as const;

  const reviewAbort = useRef<AbortController | null>(null);
  const accessStatus = useRef(protocol.status);
  accessStatus.current = protocol.status;
  useEffect(() => {
    if (protocol.status === "disabled" || protocol.status === "error") reviewAbort.current?.abort();
    return () => reviewAbort.current?.abort();
  }, [protocol.status]);
  const runAgentWorkflow = async (userPrompt: string) => {
    if (!userPrompt.trim() || isExecuting) return;
    setPrompt(userPrompt); setIsExecuting(true); setSynthesisResult(null);
    reviewAbort.current?.abort();
    const controller = new AbortController(); reviewAbort.current = controller;
    setExecutionTrace([{id: "paper", kind: "query-paper", title: "Read publisher evidence", detail: "Waiting for the independent Video publisher reply", status: "running"}]);
    try {
      const remote = videoFrameRef.current?.contentWindow;
      if (isProtocolDisabled || !normalizedVideoOrigin || !remote) throw new Error("Independent evidence is unavailable or publisher access is off");
      const paperEvidence = service.search("final analyzed sample")[0]?.evidence;
      if (!paperEvidence) throw new Error("Paper evidence unavailable");
      const result = await connectedReview({
        paper: paperEvidence, paperOrigin: window.location.origin, videoOrigin: normalizedVideoOrigin,
        readVideo: () => requestVideoEvidence(window, remote, normalizedVideoOrigin, controller.signal),
        canContinue: () => !controller.signal.aborted && !["disabled", "error", "checking"].includes(accessStatus.current),
        propose: request => dispatchPublisher(requestFocusAction(request))
      });
      setExecutionTrace([
        {id: "paper", kind: "query-paper", title: "Paper passage retrieved", detail: `${paperEvidence.sourceOrigin}: ${paperEvidence.excerpt}`, status: "success"},
        {id: "video", kind: "query-video", title: "Independent Video reply received", detail: `${result.video.sourceOrigin} | ${result.video.locator}: ${result.video.excerpt}`, status: "success"},
        {id: "derive", kind: "derivation", title: "Controlled comparison", detail: "40 - 6 = 34. Fictional study; this does not establish scientific truth.", status: "success"},
        {id: "human", kind: "stage-focus", title: "Proposal saved for human review", detail: "Citation status is unchanged. Only Confirm changes it to blocked; Reject dismisses the proposal.", status: "success"}
      ]);
      setSynthesisResult({mode: "augmented", title: "Independent evidence received", finding: "The returned passages disagree: 40 reported, 6 excluded, 34 remaining.", details: "A review proposal is saved in this browser. A human must confirm or reject it below; no citation decision was made automatically."});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Evidence review failed";
      setExecutionTrace([{id: "blocked", kind: "fail-closed", title: "Review stopped", detail: message, status: "blocked"}]);
      setSynthesisResult({mode: "revoked", title: "No verified result", finding: message, details: "No successful proposal or new citation decision is claimed. Existing saved decisions are preserved. You can still read and search the paper."});
    } finally { setIsExecuting(false); }
  };

  useEffect(() => {
    let frame = 0;
    const update = () => {
      const positions = STAGE_CHAPTERS.flatMap(({ id }) => {
        const element = document.getElementById(id);
        return element ? [{ id, top: element.getBoundingClientRect().top }] : [];
      });
      setActiveStageChapter((current) => selectActiveChapter(positions, current));
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
    };
  }, []);

  useEffect(() => {
    const effectOrigin = normalizedVideoOrigin;
    const currentAttempt = readinessAttemptRef.current;
    if (!effectOrigin) {
      cleanupVideoReadinessAttempt(readinessAttemptRef);
      setVideoReadiness({ origin: null, available: false });
    } else if (!currentAttempt || currentAttempt.origin !== effectOrigin) {
      cleanupVideoReadinessAttempt(readinessAttemptRef);
      setVideoReadiness({ origin: effectOrigin, available: null });
    }
    return () => {
      if (effectOrigin) cleanupVideoReadinessAttempt(readinessAttemptRef, effectOrigin);
    };
  }, [normalizedVideoOrigin]);

  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const saved = window.localStorage.getItem("vedaxi-theme");
        if (saved === "light" || saved === "dark") return saved;
        return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
      }
    } catch {
      return "dark";
    }
    return "dark";
  });
  const [isDevConsoleOpen, setIsDevConsoleOpen] = useState(false);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("vedaxi-theme", next);
      }
    } catch {
      // Ignore in restricted environments
    }
  };

  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      if (typeof window === "undefined") return;
      const total = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(total > 0 ? Math.min(100, Math.max(0, (window.scrollY / total) * 100)) : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [tourStep, setTourStep] = useState<number | null>(null);
  const [finalPilotEmail, setFinalPilotEmail] = useState(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem("vedaxi-pilot-email") || "";
      }
    } catch {
      return "";
    }
    return "";
  });
  const [finalPilotSubmitted, setFinalPilotSubmitted] = useState(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        return Boolean(window.localStorage.getItem("vedaxi-pilot-email"));
      }
    } catch {
      return false;
    }
    return false;
  });

  const handleFinalPilotSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!finalPilotEmail.trim()) return;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("vedaxi-pilot-email", finalPilotEmail.trim());
      }
    } catch {
      setFinalPilotSubmitted(false);
      return;
    }
    setFinalPilotSubmitted(true);
  };

  const startGuidedTour = () => {
    const steps = [
      { id: "paper-top", delay: 0 },
      { id: "chapter-method", delay: 2500 },
      { id: "chapter-video", delay: 6000 },
      { id: "chapter-evidence", delay: 10000 },
      { id: "chapter-decision", delay: 14000 }
    ];
    steps.forEach(({ id, delay }, idx) => {
      setTimeout(() => {
        setTourStep(idx + 1);
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: "smooth" });
        if (idx === steps.length - 1) {
          setTimeout(() => setTourStep(null), 4000);
        }
      }, delay);
    });
  };

  useEffect(() => {
    setStageRestored(false);
  }, [focus]);

  return (
    <div className="edition-desk" data-theme={theme}>
      <div className="page-progress" aria-hidden="true">
        <i style={{ width: `${scrollProgress}%` }} />
      </div>
      <a className="skip-link" href="#paper-content">Skip to paper</a>
      <header className="masthead">
        <a className="identity" href="#paper-top" aria-label="VEDAXI Paper Integrity Desk home">
          <span className="identity__mark" aria-hidden="true">
            <img src="/brand/vdx-mark.svg" alt="" width="20" height="20" className="identity__icon" />
          </span>
          <span>VEDAXI</span>
        </a>
        <p>Research Integrity Desk · Protocol Edition</p>
        <div className="masthead__actions">
          <button
            type="button"
            className="tour-toggle-btn"
            onClick={startGuidedTour}
            aria-label="Start interactive 30 second tour"
          >
            {tourStep ? `✨ Tour: Beat ${tourStep}/5` : "✨ 30s Tour"}
          </button>
          <button
            type="button"
            className="dev-console-toggle-btn"
            onClick={() => setIsDevConsoleOpen(!isDevConsoleOpen)}
            aria-expanded={isDevConsoleOpen}
          >
            {isDevConsoleOpen ? "Hide Dev Console" : "⚡ Dev Console"}
          </button>
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
          <span className="mono">Two-Origin WebMCP Proof</span>
        </div>
      </header>

      <main id="paper-content" tabIndex={-1}>
        <div className="product-intro-hero" aria-label="VEDAXI Product Overview">
          <div className="product-intro-hero__badge mono">
            <span>VEDAXI · Autonomous Research Integrity Protocol</span>
          </div>
          <h2 className="product-intro-hero__headline">
            Check whether a paper&rsquo;s claims match its source evidence.
          </h2>
          <p className="product-intro-hero__sub">
            A controlled demonstration for <strong>researchers and peer reviewers</strong>: compare publisher-owned passages and keep the citation decision with a human. The sample study is fictional.
          </p>
          <div className="product-intro-hero__actions">
            <a href="#focus-preview-title" className="product-intro-btn product-intro-btn--primary">
              ▶ Run 15s Interactive Proof
            </a>
            <a href="#study-flow" className="product-intro-btn product-intro-btn--secondary">
              Inspect 40 ≠ 34 Contradiction ↘
            </a>
          </div>
        </div>

        <section className="protocol-3d-section" id="protocol-3d-stage" aria-label="Interactive 3D Protocol Stage">
          <div className="protocol-3d-section__header">
            <span className="eyebrow">Interactive 3D Protocol Visualizer</span>
            <h2>Two-Origin WebMCP Constellation</h2>
            <p className="protocol-3d-section__desc">
              Illustrative 3D map of Paper, Video, and human review. Use the evidence review below to see actual returned passages and execution status; the animation is not an execution receipt.
            </p>
          </div>
          <div className="protocol-3d-stage-container">
            <ProtocolStage3D activeChapter={activeStageChapter} theme={theme} />
          </div>
        </section>

        <PaperSearch service={service} />

        <section className="paper-hero" id="paper-top" aria-labelledby="paper-title">
          <div className="edition-scene edition-scene--hero" aria-hidden="true">
            <div className="edition-scene__painting" aria-hidden="true" />
            <div className="edition-scene__halo" aria-hidden="true" />
            <div className="edition-scene__frame" aria-hidden="true" />
          </div>
          <div className="paper-hero__meta">
            <p>{paper.journal}</p>
            <p>{paper.published}</p>
            <p className="mono">{paper.identifier}</p>
          </div>
          <div className="paper-hero__title">
            <p className="eyebrow">Integrity gallery / methods on parchment</p>
            <h1 className="display-title" id="paper-title" tabIndex={-1}>{paper.title}</h1>
            <p className="dek">{paper.dek}</p>
            <p className="authors">{paper.authors.join(" · ")}</p>
          </div>

          <details className="supplementary-disclosure" aria-label="Judge fast track and executive demonstration">
            <summary>⚡ Judge Fast-Track & 15s Challenge Brief</summary>
            <div className="judge-fast-track-card" aria-label="Judge fast track and executive demonstration">
              <div className="judge-fast-track-header">
                <span className="judge-badge">⚡ JUDGE FAST-TRACK (15s DEMO)</span>
                <span className="judge-meta-tag">Two-Origin WebMCP Challenge Proof</span>
              </div>
              <p className="judge-lead">
                <strong>The Problem:</strong> A single AI reading the paper alone believes <strong>40 participants</strong> were analyzed.
                <br />
                <strong>The Solution:</strong> The guided bridge requests the independent Video passage. The controlled comparison checks the returned passages and proposes review. Only a human can block the citation.
              </p>
              <div className="judge-action-row">
                <button
                  type="button"
                  className="judge-run-btn"
                  disabled={isExecuting || isProtocolDisabled}
                  onClick={() => runAgentWorkflow("Compare paper cohort with author video transcript")}
                >
                  ▶ Run 15s Interactive Proof
                </button>
                <a
                  href="#protocol-3d-stage"
                  target="_blank"
                  rel="noreferrer"
                  className="judge-link-btn"
                >
                  Open 3D Protocol Story Map ↗
                </a>
              </div>
              <div className="judge-rubric-pills">
                <span>🛡️ Publisher access control</span>
                <span>🧪 Controlled fixture tests</span>
                <span>⚡ Browser-native tools</span>
                <span>🔒 Two-Phase Human Gate</span>
              </div>
            </div>
          </details>

          <details className="supplementary-disclosure" aria-label="What VEDAXI WebMCP Solves">
            <summary>🛡️ What VEDAXI WebMCP Solves (Core Innovation)</summary>
            <div className="webmcp-mission-card" aria-label="What VEDAXI WebMCP Solves">
              <div className="webmcp-mission-header">
                <span className="eyebrow">The Core Innovation</span>
                <h2 className="webmcp-mission-title">What VEDAXI WebMCP Solves</h2>
                <p className="webmcp-mission-subtitle">
                  Publisher-owned evidence from two origins, with a human decision before changing citation status.
                </p>
              </div>
              <div className="webmcp-mission-grid">
                <div className="webmcp-mission-step webmcp-mission-step--problem">
                  <div className="step-icon" aria-hidden="true">❌</div>
                  <div className="step-content">
                    <h3>1. The Single-Source Flaw</h3>
                    <p>
                      Reading only one source can miss conflicting evidence. This fictional paper reports <strong>40 participants</strong>; the separate Video publisher describes exclusions.
                    </p>
                  </div>
                </div>
                <div className="webmcp-mission-step webmcp-mission-step--discovery">
                  <div className="step-icon" aria-hidden="true">⚡</div>
                  <div className="step-content">
                    <h3>2. Cross-Origin WebMCP Protocol</h3>
                    <p>
                      VEDAXI uses <strong>WebMCP browser tools</strong>, enabling the AI agent to query independent web origins. The agent inspects the author&rsquo;s conference talk (Origin B at 00:03:12) where they admit <strong>6 participants had sensor calibration drift</strong>.
                    </p>
                  </div>
                </div>
                <div className="webmcp-mission-step webmcp-mission-step--resolution">
                  <div className="step-icon" aria-hidden="true">🛡️</div>
                  <div className="step-content">
                    <h3>3. Fail-Closed Integrity Gate</h3>
                    <p>
                      The guided comparison proposes the discrepancy (<strong>40 ≠ 34</strong>). The citation remains unchanged until a human selects <strong>Confirm and block citation</strong>; Reject dismisses the proposal.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </details>

          <details className="supplementary-disclosure" aria-label="Native WebMCP Protocol Surface">
            <summary>⚡ Native WebMCP Protocol & Tool Diagnostics</summary>
            <ProtocolStatus protocol={protocol} service={service} />
          </details>
        </section>

        <section className="focus-preview agent-copilot" aria-labelledby="focus-preview-title">
          <div className="agent-copilot__header">
            <div>
              <p className="eyebrow">Guided cross-origin review · reads publisher evidence services</p>
              <h2 id="focus-preview-title">Focused Review</h2>
              <p>Run the controlled comparison and inspect the returned passages before making a decision.</p>
            </div>
            <div className="agent-copilot__controls-cluster">
              <button
                type="button"
                className="copilot-toggle-btn"
                onClick={isProtocolDisabled ? protocol.enable : protocol.disable}
              >
                {isProtocolDisabled ? "Enable WebMCP Tools" : "Turn WebMCP Off"}
              </button>
              <div className="agent-copilot__status-badge" data-disabled={isProtocolDisabled}>
                {protocol.status === "active" ? "Native WebMCP active · guided bridge available" : protocol.status === "unsupported" ? "Native WebMCP unavailable · guided bridge available" : protocol.status === "checking" ? "Checking native WebMCP" : "Publisher tools and guided access off"}
              </div>
            </div>
          </div>

          <div className="benchmark-suite-card">
            <h3>One controlled study, two independent publishers</h3>
            <p>This guided check reads the Paper evidence service and waits for the Video publisher to return its own transcript passage. It proposes a discrepancy for a human decision.</p>
            <p>No model is called. The browser bridge is separate from native WebMCP, which is available only in supporting browsers. This is a fictional study, not an accuracy benchmark.</p>
            <button type="button" disabled={isExecuting || isProtocolDisabled} onClick={() => runAgentWorkflow("Compare paper cohort with author video transcript")}>Compare both publishers</button>
          </div>

          <form
            className="copilot-form"
            onSubmit={(e) => {
              e.preventDefault();
              runAgentWorkflow(prompt);
            }}
          >
            <label htmlFor="copilot-prompt" className="copilot-prompt-label">
              Review question
            </label>
            <div className="copilot-form__controls">
              <input
                id="copilot-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Compare paper cohort with author video transcript…"
                disabled={isExecuting}
              />
              <button type="submit" disabled={isExecuting || !prompt.trim()}>
                {isExecuting ? "Reading evidence…" : "Run evidence review"}
              </button>
            </div>
          </form>

          <div className="copilot-presets" aria-label="Suggested agent research queries">
            <span>Try research queries:</span>
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={isExecuting}
                onClick={() => runAgentWorkflow(preset)}
              >
                {preset}
              </button>
            ))}
          </div>

          {synthesisResult && (
            <div className={`copilot-synthesis copilot-synthesis--${synthesisResult.mode}`} role="region" aria-live="polite">
              <div className="synthesis-header">
                <strong>{synthesisResult.title}</strong>
                <span className="mono">{synthesisResult.mode === "augmented" ? "Publisher reply received" : "Fail-Closed Surface"}</span>
              </div>
              <p className="synthesis-finding">{synthesisResult.finding}</p>
              <p className="synthesis-details mono">{synthesisResult.details}</p>
            </div>
          )}

          {executionTrace && (
            <div className="copilot-trace" role="status" aria-live="polite">
              <p className="eyebrow mono">Guided evidence execution trace</p>
              <ol className="copilot-trace__steps">
                {executionTrace.map((step) => (
                  <li key={step.id} className={`trace-step trace-step--${step.status}`}>
                    <div className="trace-step__head">
                      <span className="trace-step__marker" />
                      <strong>{step.title}</strong>
                    </div>
                    <p className="trace-step__detail mono">{step.detail}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="copilot-fallback">
            <button
              type="button"
              disabled={hasFocus}
              onClick={() => runAgentWorkflow("Compare paper cohort with author video transcript")}
            >
              {hasFocus ? "Focus review active" : "Run deterministic focus preview"}
            </button>
          </div>
        </section>

        {isDevConsoleOpen && (
          <section className="dev-console-card" aria-label="WebMCP Developer Console & Telemetry Inspector">
            <div className="dev-console-header">
              <div className="dev-console-title">
                <span className="dev-console-icon">⚡</span>
                <div>
                  <h3>WebMCP Developer Console & Protocol Inspector</h3>
                  <p className="mono-subtext">Browser-native tool registration and guided evidence transport</p>
                </div>
              </div>
            </div>
            <div className="dev-console-body">
              <div className="dev-console-panel">
                <p>Native browser tools: search_paper_evidence and request_discrepancy_focus on Paper; search_video_evidence and read_video_transcript on Video.</p>
                <p>These tools are registered with the browser, not HTTP POST endpoints. The guided comparison uses an origin-checked, read-only postMessage bridge to the same Video evidence service.</p>
                <p>Native registration: {protocol.status}. Execution results appear in the review trace only after a reply; this panel does not fabricate request or response logs.</p>
              </div>
            </div>
          </section>
        )}
        {publisherError && (
          <div className="publisher-error" role="alert">
            <p>{publisherError}</p>
            <button type="button" onClick={() => dispatchPublisher(resetPublisherAction())}>
              Reset failed review
            </button>
          </div>
        )}

        <div className="paper-layout">
          <StageNavigation
            activeChapter={activeStageChapter}
            announce
            onActiveChapterChange={setActiveStageChapter}
            variant="mobile"
          />

          <div className="paper-navigation-column">
            <StageNavigation
              activeChapter={activeStageChapter}
              announce={false}
              onActiveChapterChange={setActiveStageChapter}
              variant="desktop"
            />
            <nav className="paper-outline" aria-label="Paper outline">
              <p className="eyebrow">Within the paper</p>
              <ol>
                <li><a href="#abstract" onClick={(e) => { e.preventDefault(); document.getElementById("abstract")?.scrollIntoView({ behavior: "smooth", block: "start" }); window.history.pushState(null, "", "#abstract"); }}>Abstract</a></li>
                <li><a href="#methods" onClick={(e) => { e.preventDefault(); document.getElementById("methods")?.scrollIntoView({ behavior: "smooth", block: "start" }); window.history.pushState(null, "", "#methods"); }}>Methods</a></li>
                <li><a href="#study-flow" onClick={(e) => { e.preventDefault(); document.getElementById("study-flow")?.scrollIntoView({ behavior: "smooth", block: "start" }); window.history.pushState(null, "", "#study-flow"); }}>Study flow</a></li>
                <li><a href="#limitations" onClick={(e) => { e.preventDefault(); document.getElementById("limitations")?.scrollIntoView({ behavior: "smooth", block: "start" }); window.history.pushState(null, "", "#limitations"); }}>Limitations</a></li>
                <li><a href="#references" onClick={(e) => { e.preventDefault(); document.getElementById("references")?.scrollIntoView({ behavior: "smooth", block: "start" }); window.history.pushState(null, "", "#references"); }}>References</a></li>
              </ol>
            </nav>
          </div>

          <details className="paper-outline-mobile">
            <summary>Paper outline</summary>
            <nav aria-label="Paper outline on small screens">
              <a href="#abstract" onClick={(e) => { e.preventDefault(); document.getElementById("abstract")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Abstract</a>
              <a href="#methods" onClick={(e) => { e.preventDefault(); document.getElementById("methods")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Methods</a>
              <a href="#study-flow" onClick={(e) => { e.preventDefault(); document.getElementById("study-flow")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Study flow</a>
              <a href="#limitations" onClick={(e) => { e.preventDefault(); document.getElementById("limitations")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Limitations</a>
              <a href="#references" onClick={(e) => { e.preventDefault(); document.getElementById("references")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>References</a>
            </nav>
          </details>

          <article
            className={`paper-article${focusActive ? " paper-article--focused" : ""}`}
            data-focus-state={focusActive ? "focused" : "ordinary"}
          >
            <details className="supplementary-disclosure manuscript-disclosure" aria-label="Full research manuscript and evidence dossier">
              <summary>📄 Full Research Manuscript & Evidence Dossier (Chapters 01–04, Study Flow, References)</summary>
              <section className="stage-chapter stage-chapter--paper edition-scene edition-scene--parchment" aria-labelledby="abstract-title">
                <div className="edition-scene__painting" aria-hidden="true" />
                <div className="edition-scene__frame" aria-hidden="true" />
                <div className="edition-scene__caption">
                <p className="stage-chapter__index mono">Chapter 01 / Paper</p>
                <div id="abstract">
                  <p className="section-kicker">Study overview & Abstract</p>
                  <h2 id="abstract-title">Abstract</h2>
                  <p className="lead">{paper.abstract}</p>
                  <p>
                    Modern analytical research is characterized by frequent, high-friction context switches that disrupt cognitive flow.
                    While traditional evaluation frameworks quantify simple task completion, the latent cognitive overhead required to rebuild working memory remains largely unaccounted for.
                    In this controlled empirical trial, we establish an experimental baseline for contextual state recovery, measuring both resumption latency and error susceptibility across structured analytical evidence synthesis.
                  </p>
                  <p className="mono paper-keywords">
                    <strong>Keywords:</strong> Cognitive State Reconstruction · Context Interruption · Provenance Verification · Multi-Modal Evidence · WebMCP Standard
                  </p>
                </div>
                </div>
              </section>

              <section className="stage-chapter stage-chapter--method edition-scene edition-scene--triptych" id="chapter-method" aria-labelledby="methods-title">
                <div className="edition-scene__painting" aria-hidden="true" />
                <div className="edition-scene__frame" aria-hidden="true" />
                <div className="edition-scene__caption">
                <p className="stage-chapter__index mono">Chapter 02 / Method</p>
                <div id="methods">
                  <p className="section-kicker">Experimental Protocol & Procedures</p>
                  <h2 id="methods-title" tabIndex={-1}>Methods</h2>
                  <p className="lead">{paper.methodsIntroduction}</p>
                  
                  <h3>2.1 Experimental Protocol</h3>
                  <p>
                    Participants were subjected to a standardized multi-source document coding workflow involving qualitative evidence synthesis and numerical verification.
                    Each evaluation trial comprised a baseline undisturbed phase, a standardized 180-second forced context interruption, and an unassisted task resumption phase.
                    Continuous biometric telemetry and sensory calibration monitors tracked gaze fixation stability, task resumption latency, and decision confidence.
                  </p>

                  <h3>2.2 Eligibility Criteria & Stopping Rules</h3>
                  <p>
                    Eligibility required proficiency in technical document verification and baseline visual-spatial tracking calibration.
                    A pre-registered stopping rule dictated session termination if hardware calibration drift exceeded 0.05 RMS error thresholds.
                    The full analytical methodology and data integrity checkpoints were registered prior to data collection.
                  </p>

                  <h3>2.3 Cohort Accounting & Sample Allocation</h3>
                  <p className="methods-cohort-paragraph">
                    Forty participants completed the study and were included in the final analysis.
                    Participant progression through enrollment, experimental allocation, and final computational evaluation was logged according to pre-specified protocol criteria.
                  </p>
                </div>

                <div id="study-flow" aria-labelledby="study-flow-title">
                  <p className="section-kicker">Reported flow</p>
                  <h2 id="study-flow-title">Study flow</h2>
                  <figure className="study-flow">
                    <div className="study-flow__plot" role="img" aria-label="Three study flow stages: 40 enrolled, 6 excluded for sensor calibration drift, and 34 in final analysis.">
                      {[
                        ["Enrolled", "40", "cohort"],
                        ["Excluded (Drift)", "−6", "drift"],
                        ["Final analysis", "34", "verified"]
                      ].map(([label, value, tag]) => (
                        <div className={`study-flow__stage study-flow__stage--${tag}`} key={label}>
                          <span className="study-flow__value">{value}</span>
                          <div className="study-flow__label-row">
                            <span>{label}</span>
                            {tag === "drift" && <span className="stage-tag mono">00:03:12</span>}
                            {tag === "verified" && <span className="stage-tag stage-tag--ok mono">40 − 6</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                    <figcaption>Figure 1. Participant accounting: 40 enrolled, 6 excluded for sensor calibration drift, 34 in final analysis.</figcaption>
                  </figure>

                  <div className="study-flow-discrepancy" role="region" aria-label="Cross-Origin Discrepancy Analysis">
                    <div className="study-flow-discrepancy__header">
                      <span className="eyebrow">WebMCP Discrepancy Proof</span>
                      <span className="discrepancy-badge mono">Contradiction: 40 ≠ 34</span>
                    </div>
                    <div className="study-flow-discrepancy__grid">
                      <div className="study-flow-discrepancy__card">
                        <span className="origin-label mono">Origin A · Written Paper</span>
                        <strong className="math-statement">40 Enrolled → 0 Excluded → 40 Analyzed</strong>
                        <p>The published text claims full 40-cohort analysis with zero reported exclusions.</p>
                      </div>
                      <div className="study-flow-discrepancy__card study-flow-discrepancy__card--warn">
                        <span className="origin-label mono">Origin B · Author Video (00:03:12)</span>
                        <strong className="math-statement">40 Enrolled − 6 Excluded = 34 Analyzed</strong>
                        <p>Author explicitly admits: <em>&ldquo;Six sessions had calibration drift, so we removed them...&rdquo;</em></p>
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              </section>

              <section className="stage-chapter stage-chapter--video edition-scene edition-scene--reversed" id="chapter-video" aria-labelledby="video-title">
                <div className="edition-scene__painting" aria-hidden="true" />
                <div className="edition-scene__frame" aria-hidden="true" />
                <EditionWorld reverse />
                <div className="edition-scene__caption">
                <p className="stage-chapter__index mono">Chapter 03 / Video</p>
                <div>
                  <p className="section-kicker">Independent publisher, inverted world</p>
                  <h2 id="video-title" tabIndex={-1}>Video transcript evidence</h2>
                  <p>The Video publisher is hosted independently and appears here only after it confirms readiness. The reversed field is decoration; transcript evidence stays upright and unpublished until the origin answers.</p>
                </div>
                {normalizedVideoOrigin && (
                  <iframe
                    className="video-publisher"
                    hidden={videoAvailable !== true}
                    onLoad={() => {
                      const attemptOrigin = normalizedVideoOrigin;
                      const generation = ++readinessGenerationRef.current;
                      cleanupVideoReadinessAttempt(readinessAttemptRef);
                      setVideoReadiness({ origin: attemptOrigin, available: null });
                      const videoWindow = videoFrameRef.current?.contentWindow;
                      if (!videoWindow) {
                        setVideoReadiness({ origin: attemptOrigin, available: false });
                        return;
                      }
                      const attempt: VideoReadinessAttempt = {
                        origin: attemptOrigin,
                        generation,
                        cleanup: () => undefined
                      };
                      readinessAttemptRef.current = attempt;
                      attempt.cleanup = startVideoReadinessAttempt(
                        window,
                        attemptOrigin,
                        videoWindow,
                        (available) => {
                          if (readinessAttemptRef.current !== attempt) return;
                          setVideoReadiness({ origin: attemptOrigin, available });
                        }
                      );
                    }}
                    ref={videoFrameRef}
                    src={normalizedVideoOrigin}
                    title="Independent Video publisher evidence"
                  />
                )}
                {videoConfigurationError ? (
                  <p role="alert">
                    Independent Video publisher configuration is invalid: {videoConfigurationError}. No embedded evidence is shown.
                  </p>
                ) : videoAvailable !== true && (
                  <div className="embedded-video-card">
                    <p role="status" className="embedded-video-status">
                      {videoAvailable === null
                        ? "Checking whether the independent Video publisher is available."
                        : "Independent Video publisher could not be verified or is unavailable. No independent evidence has been received. The local illustration below is not a successful cross-origin result."}
                    </p>
                    <div className="embedded-video-wrapper">
                      <video
                        className="native-video-player"
                        controls
                        preload="metadata"
                        src="/media/vedaxi-controlled-evidence.mp4"
                        aria-label="Recorded source video: calibration drift evidence"
                      >
                        <track kind="captions" src="/media/vedaxi-controlled-evidence.vtt" srcLang="en" label="English" default />
                      </video>
                    </div>
                    <div className="embedded-transcript-cue">
                      <div className="cue-header">
                        <span className="mono cue-badge">00:03:12 (192s)</span>
                        <span className="eyebrow">Author Statement</span>
                      </div>
                      <p className="cue-body">
                        &ldquo;We recruited forty participants. Six sessions had calibration drift, so we removed them before modeling and did not replace them.&rdquo;
                      </p>
                      <div className="cue-provenance mono">
                        <span>ID: video.transcript.calibration-drift</span>
                        <span>Locator: Transcript 00:03:12</span>
                      </div>
                    </div>
                  </div>
                )}
                </div>
              </section>

              <section className="stage-chapter stage-chapter--evidence edition-scene edition-scene--burn" id="chapter-evidence" aria-labelledby="evidence-title">
                <div className="edition-scene__painting" aria-hidden="true" />
                <div className="edition-burn" aria-hidden="true" />
                <div className="edition-scene__frame" aria-hidden="true" />
                <div className="edition-scene__caption edition-scene__caption--reveal">
                  <p className="stage-chapter__index mono">Chapter 04 / Evidence Dossier</p>
                  <p className="section-kicker">Multi-Origin Corroboration</p>
                  <h2 id="evidence-title" tabIndex={-1}>Cross-Origin Evidence Comparison</h2>
                  <p className="lead">
                    Illustrative dossier for the fictional study. Run the guided comparison above to retrieve the independent Video passage; this static dossier does not certify a live request.
                  </p>

                  <div className="evidence-dossier-grid">
                    {/* Origin A */}
                    <div className="evidence-card evidence-card--origin-a" id="methods-participants" tabIndex={-1}>
                      <div className="evidence-card__badge mono">Origin A · Published Manuscript</div>
                      <blockquote cite={`${evidence.sourceOrigin}/#methods-participants`}>
                        <p>{evidence.excerpt}</p>
                      </blockquote>
                      <aside className="provenance" aria-label="Evidence provenance">
                        <p className="eyebrow">Manuscript Provenance</p>
                        <dl>
                          <div><dt>Locator</dt><dd>{evidence.locator}</dd></div>
                          <div><dt>Reported</dt><dd><strong>40 Analyzed (0 Excluded)</strong></dd></div>
                          <div><dt>Origin</dt><dd className="mono">{evidence.sourceOrigin}</dd></div>
                          <div><dt>Evidence ID</dt><dd className="mono">{evidence.id}</dd></div>
                          <div><dt>Provenance</dt><dd>{evidence.provenance}</dd></div>
                        </dl>
                      </aside>
                    </div>

                    {/* Origin B */}
                    <div className="evidence-card evidence-card--origin-b">
                      <div className="evidence-card__badge evidence-card__badge--video mono">Origin B · Author Video Talk (00:03:12)</div>
                      <blockquote cite={normalizedVideoOrigin ? `${normalizedVideoOrigin}/#00:03:12` : undefined}>
                        <p>&ldquo;We recruited forty participants. Six sessions had calibration drift, so we removed them before modeling and did not replace them.&rdquo;</p>
                      </blockquote>
                      <aside className="provenance" aria-label="Origin B evidence provenance">
                        <p className="eyebrow">Video Talk Provenance</p>
                        <dl>
                          <div><dt>Locator</dt><dd>Transcript Cue 00:03:12</dd></div>
                          <div><dt>Admitted</dt><dd><strong>34 Analyzed (6 Excluded)</strong></dd></div>
                          <div><dt>Origin</dt><dd className="mono">{normalizedVideoOrigin ?? "Not configured"}</dd></div>
                          <div><dt>Evidence ID</dt><dd className="mono">video.transcript.calibration-drift</dd></div>
                        </dl>
                      </aside>
                    </div>
                  </div>

                  <div className="evidence-verdict-banner">
                    <div className="verdict-tag mono">⚡ DISCREPANCY VERDICT: 40 ≠ 34</div>
                    <p>
                      <strong>Integrity Alert:</strong> The published paper silently omitted 6 excluded participants.
                      An AI relying solely on the text would cite a false sample size of 40.
                      The guided review can propose this discrepancy using returned passages. Citation status changes only after human confirmation in Chapter 05.
                    </p>
                  </div>
                </div>
              </section>

              <div id="limitations">
                <p className="section-kicker">Scope note</p>
                <h2 id="limitations-title">Limitations</h2>
                <p>{paper.limitations}</p>
              </div>

              <div id="references" aria-labelledby="references-title">
                <p className="section-kicker">Source list</p>
                <h2 id="references-title">References</h2>
                <ol className="references">
                  {paper.references.map((reference) => (
                    <li key={reference.id}><span className="mono">{reference.id}</span> {reference.citation}</li>
                  ))}
                </ol>
              </div>
            </details>

            <section className="stage-chapter stage-chapter--decision edition-scene edition-scene--seal" id="chapter-decision" aria-labelledby="focus-decision-title">
              <div className="edition-scene__painting" aria-hidden="true" />
              <div className="edition-scene__frame" aria-hidden="true" />
              <div className="edition-scene__caption">
              <p className="stage-chapter__index mono">Chapter 05 / Decision</p>
              <div className="focus-decision" aria-live="polite">
                <p className="section-kicker">Human checkpoint</p>
                <h2 id="focus-decision-title" tabIndex={-1}>Focus decision</h2>
                {hasFocus && (
                  <div className="focus-view-actions">
                    <button type="button" onClick={() => setStageRestored(!focusActive)}>
                      {focusActive ? "Restore full workspace" : "Review focused evidence"}
                    </button>
                  </div>
                )}
                {publisherState.focusProposal && (
                  <>
                    <p className="focus-derivation">{publisherState.focusProposal.provenance.derivation}</p>
                    <p>{publisherState.focusProposal.reasoning}</p>
                    <dl className="focus-provenance">
                      <div><dt>Paper</dt><dd>{publisherState.focusProposal.provenance.paper}</dd></div>
                      <div><dt>Video</dt><dd>{publisherState.focusProposal.provenance.video}</dd></div>
                    </dl>
                    <div className="focus-actions">
                      <button
                        type="button"
                        onClick={() => dispatchPublisher(confirmFocusAction({ confirmedBy: "human" }))}
                      >Confirm focus</button>
                      <button type="button" onClick={() => dispatchPublisher(rejectFocusAction())}>
                        Reject focus
                      </button>
                    </div>
                  </>
                )}
                {publisherState.discrepancyNote && (
                  <aside className="discrepancy-note">
                    <p><strong>Citation status: blocked</strong></p>
                    <p>{publisherState.discrepancyNote.provenance.derivation}</p>
                    <p>{publisherState.discrepancyNote.reasoning}</p>
                    <a href="#methods-participants">Review linked publisher evidence</a>
                    <dl className="focus-provenance">
                      <div><dt>Paper evidence ID</dt><dd className="mono">{publisherState.discrepancyNote.paperEvidenceId}</dd></div>
                      <div><dt>Video evidence ID</dt><dd className="mono">{publisherState.discrepancyNote.videoEvidenceId}</dd></div>
                      <div><dt>Paper provenance</dt><dd>{publisherState.discrepancyNote.provenance.paper}</dd></div>
                      <div><dt>Video provenance</dt><dd>{publisherState.discrepancyNote.provenance.video}</dd></div>
                    </dl>
                    <button type="button" onClick={() => dispatchPublisher(resetPublisherAction())}>
                      Reset focus review
                    </button>
                  </aside>
                )}
                {!hasFocus && <p>No focus proposal is awaiting review.</p>}
                {publisherState.auditEvents.length > 0 && (
                  <ol className="review-history" aria-label="Review history">
                    {publisherState.auditEvents.map((event, index) => (
                      <li key={`${event.type}-${index}`}>{reviewHistoryCopy(event)}</li>
                    ))}
                  </ol>
                )}
              </div>
              </div>
            </section>

            <section className="post-demo-pilot" id="research-pilot" aria-labelledby="pilot-section-title">
              <span className="eyebrow mono">Continuous Pipeline Integrity</span>
              <h3 id="pilot-section-title" className="final-pilot-title">Pilot interest (local demo)</h3>
              <p className="pilot-subtitle">
                This form saves an interest note in this browser only. It does not enroll you, contact the team, or send your email to a server.
              </p>
              {finalPilotSubmitted ? (
                <div className="pilot-confirmation" role="status">
                  <span className="pilot-confirmation__icon" aria-hidden="true">✓</span>
                  <div>
                    <strong>Interest note saved on this device.</strong>
                    <p className="mono text-xs">{finalPilotEmail}</p>
                  </div>
                </div>
              ) : (
                <form className="final-pilot-form" onSubmit={handleFinalPilotSubmit}>
                  <label htmlFor="pilot-email-input" className="sr-only">Researcher email</label>
                  <input
                    id="pilot-email-input"
                    name="email"
                    type="email"
                    required
                    value={finalPilotEmail}
                    onChange={(e) => setFinalPilotEmail(e.target.value)}
                    placeholder="researcher@institution.edu"
                  />
                  <button type="submit" className="final-pilot-submit-btn">
                    Save local interest note
                  </button>
                </form>
              )}
            </section>
          </article>

          <aside className="desk-note" aria-label="Fixture notice">
            <p className="eyebrow">Fixture notice</p>
            <p>This is a fictional controlled fixture. It demonstrates publisher evidence provenance and does not describe a real study.</p>
          </aside>
        </div>
      </main>

      <details className="capability-drawer" aria-label="Review capabilities drawer">
        <summary className="capability-drawer__toggle">
          <span className="capability-drawer__icon" aria-hidden="true">⚡</span>
          <span>Review capabilities</span>
        </summary>
        <div className="capability-drawer__content">
          {focusActive && (
            <nav className="focus-pins" aria-label="Pinned focus context">
              <p className="eyebrow">Pinned context</p>
              <a href="#chapter-method">Paper evidence</a>
              <a href="#chapter-video">Video evidence</a>
              <a href="#chapter-evidence">Publisher provenance</a>
              <a href="#chapter-decision">Focus decision</a>
            </nav>
          )}
          <nav aria-label="Capability drawer">
            <a href="#paper-top">Paper</a>
            <a href="#chapter-video">Video</a>
            <a href="#chapter-evidence">Evidence</a>
            <a href="#chapter-decision">Decision</a>
          </nav>
        </div>
      </details>

      <footer>
        <p>VEDAXI / research integrity before citation</p>
        <p className="mono">{paper.identifier} · {evidence.sourceOrigin}</p>
      </footer>

      <a href="#paper-top" className="story-index-return" aria-label="Return to top">
        <span>Return to top</span>
        ↑
      </a>
    </div>
  );
}
