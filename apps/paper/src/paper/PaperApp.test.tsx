import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FocusRequest, PublisherState } from "@vedaxi/state";

import { createPaperEvidenceService, createPaperFixture } from "./index";
import {
  PaperApp,
  cleanupVideoReadinessAttempt,
  monitorVideoReadiness,
  normalizedIndependentVideoOrigin,
  requestVideoReadiness,
  startVideoReadinessAttempt,
  videoAvailabilityForOrigin
} from "./PaperApp";

const fixture = createPaperFixture("https://paper.example.test/workspace");
const service = createPaperEvidenceService(fixture.evidence);
const focusRequest: FocusRequest = {
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
const initialPublisherState: PublisherState = {
  citationStatus: "unblocked",
  discrepancyNote: null,
  focusProposal: null,
  auditEvents: []
};

function renderStage(state: PublisherState, publisherError: string | null = null) {
  return renderToStaticMarkup(
    <PaperApp
      fixture={fixture}
      service={service}
      protocol={{ status: "unsupported", enable: () => undefined, disable: () => undefined }}
      publisherState={state}
      dispatchPublisher={() => ({ ok: true, state })}
      publisherError={publisherError}
      videoOrigin="https://video.example.test"
    />
  );
}

describe("M1 Paper Integrity Desk", () => {
  it.each([
    ["checking", "Checking native agent capabilities"],
    ["active", "Native paper evidence tool active"],
    ["disabled", "Agent tools off"],
    ["unsupported", "This browser does not expose native agent tools"],
    ["error", "Native agent tool unavailable"]
  ] as const)("keeps the full human paper in the %s protocol state", (status, copy) => {
    const markup = renderToStaticMarkup(
      <PaperApp
        fixture={fixture}
        service={service}
        protocol={{ status, enable: () => undefined, disable: () => undefined }}
      />
    );

    expect(markup).toContain(copy);
    expect(markup).toContain(fixture.document.title);
    expect(markup).toContain(fixture.evidence.excerpt);
    expect(markup).toContain(fixture.evidence.locator);
    expect(markup).toContain(fixture.evidence.sourceOrigin);
    expect(markup).toContain("Search this paper");
    expect(markup).toContain("This is a fictional controlled fixture");
  });

  it("renders semantic reading landmarks and keeps provenance next to the exact passage", () => {
    const markup = renderToStaticMarkup(
      <PaperApp
        fixture={fixture}
        service={service}
        protocol={{ status: "unsupported", enable: () => undefined, disable: () => undefined }}
      />
    );

    expect(markup).toMatch(/<header[ >]/);
    expect(markup).toMatch(/<nav[^>]+aria-label="Paper outline"/);
    expect(markup).toMatch(/<main[ >]/);
    expect(markup).toMatch(/<article[ >]/);
    expect(markup).toMatch(/<aside[^>]+aria-label="Evidence provenance"/);
    expect(markup).toMatch(/id="methods-participants" tabindex="-1"/);
    expect(markup).toMatch(/<footer[ >]/);
    expect(markup.indexOf(fixture.evidence.excerpt)).toBeLessThan(
      markup.indexOf(fixture.evidence.provenance)
    );
  });

  it("gives the human search input an unambiguous agent-facing label", () => {
    const markup = renderToStaticMarkup(
      <PaperApp
        fixture={fixture}
        service={service}
        protocol={{ status: "active", enable: () => undefined, disable: () => undefined }}
      />
    );

    expect(markup).toContain('<label for="paper-query">Paper evidence query</label>');
    expect(markup).toContain('name="query"');
  });

  it("places publication search before the paper body and exposes a magnifying-glass action", () => {
    const markup = renderToStaticMarkup(
      <PaperApp
        fixture={fixture}
        service={service}
        protocol={{ status: "active", enable: () => undefined, disable: () => undefined }}
      />
    );

    expect(markup.indexOf('class="paper-search"')).toBeLessThan(
      markup.indexOf('class="paper-hero"')
    );
    expect(markup).toContain('class="search-icon"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<span>Search</span>');
  });

  it("offers judge-friendly example searches that map to publisher evidence", () => {
    const markup = renderToStaticMarkup(
      <PaperApp
        fixture={fixture}
        service={service}
        protocol={{ status: "active", enable: () => undefined, disable: () => undefined }}
      />
    );

    expect(markup).toContain('class="edition-desk"');
    expect(markup).toContain("edition-scene--hero");
    expect(markup).toContain("edition-scene--reversed");
    expect(markup).toContain("edition-scene--burn");
    expect(markup).not.toContain("Shopify");
    expect(markup).not.toContain("Sidekick");
    expect(markup).not.toContain("Winter '26");
    expect(markup).toContain("Try one:");
    expect(markup).toContain("final analyzed sample");
    expect(markup).toContain("forty participants");
    expect(markup).toContain("included in the final analysis");
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-pressed="false"');
  });
});

describe("M4 Focused Review", () => {
  it("labels the simulated invocation honestly and keeps every capability reachable", () => {
    const markup = renderStage(initialPublisherState);

    expect(markup).toContain("Run deterministic focus preview");
    expect(markup).toContain("Guided cross-origin review · reads publisher evidence services");
    expect(markup).toContain("Focused Review");
    expect(markup).toContain('<iframe class="video-publisher" hidden=""');
    expect(markup).toContain("Checking whether the independent Video publisher is available");
    expect(markup).toContain('aria-label="Capability drawer"');
    for (const target of ["#paper-top", "#chapter-video", "#chapter-evidence", "#chapter-decision"]) {
      expect(markup).toContain(`href="${target}"`);
    }
    expect(markup).not.toContain("40 - 6 = 34");
  });

  it("accepts readiness only from the configured origin, iframe, and exact versioned payload", () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    let timeout: (() => void) | undefined;
    const windowRef = {
      location: { origin: "https://paper.example.test" },
      addEventListener: vi.fn((_type, next) => { listener = next; }),
      removeEventListener: vi.fn(),
      setTimeout: vi.fn((next) => { timeout = next; return 7; }),
      clearTimeout: vi.fn()
    } as unknown as Window;
    const videoWindow = {} as Window;
    const otherWindow = {} as Window;
    const results: boolean[] = [];

    const cleanup = monitorVideoReadiness(
      windowRef,
      "https://video.example.test/path",
      videoWindow,
      (available) => results.push(available)
    );
    const dispatch = (origin: string, source: Window, data: unknown) => {
      listener?.({ origin, source, data } as MessageEvent);
    };

    dispatch("https://wrong.example.test", videoWindow, { type: "vedaxi:video-readiness", version: 1 });
    dispatch("https://video.example.test", otherWindow, { type: "vedaxi:video-readiness", version: 1 });
    dispatch("https://video.example.test", videoWindow, { type: "vedaxi:video-readiness", version: 2 });
    dispatch("https://video.example.test", videoWindow, { type: "vedaxi:video-readiness", version: 1, extra: true });
    expect(results).toEqual([]);

    dispatch("https://video.example.test", videoWindow, { type: "vedaxi:video-readiness", version: 1 });
    expect(results).toEqual([true]);
    expect(windowRef.removeEventListener).toHaveBeenCalledWith("message", expect.any(Function));
    expect(windowRef.clearTimeout).toHaveBeenCalledWith(7);

    cleanup();
    timeout?.();
    expect(results).toEqual([true]);
  });

  it("times out unverifiable video readiness and targets only a normalized HTTP origin", () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    let timeout: (() => void) | undefined;
    const windowRef = {
      location: { origin: "https://paper.example.test" },
      addEventListener: vi.fn((_type, next) => { listener = next; }),
      removeEventListener: vi.fn(),
      setTimeout: vi.fn((next) => { timeout = next; return 9; }),
      clearTimeout: vi.fn()
    } as unknown as Window;
    const results: boolean[] = [];

    monitorVideoReadiness(windowRef, "https://video.example.test/path", {} as Window, (value) => results.push(value));
    expect(listener).toBeTypeOf("function");
    timeout?.();
    expect(results).toEqual([false]);

    const postMessage = vi.fn();
    expect(requestVideoReadiness({ postMessage } as unknown as Window, "https://video.example.test/path"))
      .toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      { type: "vedaxi:video-readiness-request", version: 1 },
      "https://video.example.test"
    );
    expect(requestVideoReadiness({ postMessage } as unknown as Window, "javascript:alert(1)"))
      .toBe(false);
  });

  it("normalizes only an independent HTTP video origin and never mounts an invalid iframe", () => {
    expect(normalizedIndependentVideoOrigin(
      "https://video.example.test/evidence?view=full",
      "https://paper.example.test/article"
    )).toBe("https://video.example.test");
    expect(normalizedIndependentVideoOrigin(
      "https://paper.example.test/video",
      "https://paper.example.test/article"
    )).toBeNull();
    expect(normalizedIndependentVideoOrigin("javascript:alert(1)", "https://paper.example.test")).toBeNull();

    const markup = renderToStaticMarkup(
      <PaperApp
        fixture={fixture}
        service={service}
        protocol={{ status: "unsupported", enable: () => undefined, disable: () => undefined }}
        videoOrigin="javascript:alert(1)"
      />
    );
    expect(markup).not.toContain("<iframe");
    expect(markup).toContain("Independent Video publisher could not be verified or is unavailable");
  });

  it("renders a configuration failure without mounting or trusting a Video iframe", () => {
    const markup = renderToStaticMarkup(
      <PaperApp
        fixture={fixture}
        service={service}
        protocol={{ status: "unsupported", enable: () => undefined, disable: () => undefined }}
        videoConfigurationError="Video origin configuration is missing"
      />
    );

    expect(markup).not.toContain("<iframe");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Video origin configuration is missing");
    expect(markup).toContain("No embedded evidence is shown");
  });

  it("arms each readiness attempt before posting and revalidates a reload", () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    let timeout: (() => void) | undefined;
    const windowRef = {
      location: { origin: "https://paper.example.test" },
      addEventListener: vi.fn((_type, next) => { listener = next; }),
      removeEventListener: vi.fn(),
      setTimeout: vi.fn((next) => { timeout = next; return 15; }),
      clearTimeout: vi.fn()
    } as unknown as Window;
    let respondSynchronously = true;
    const videoWindow = {
      postMessage: vi.fn(() => {
        expect(listener).toBeTypeOf("function");
        if (respondSynchronously) {
          listener?.({
            origin: "https://video.example.test",
            source: videoWindow,
            data: { type: "vedaxi:video-readiness", version: 1 }
          } as unknown as MessageEvent);
        }
      })
    } as unknown as Window;
    const results: boolean[] = [];

    const firstCleanup = startVideoReadinessAttempt(
      windowRef,
      "https://video.example.test/path",
      videoWindow,
      (available) => results.push(available)
    );
    expect(results).toEqual([true]);

    firstCleanup();
    respondSynchronously = false;
    startVideoReadinessAttempt(
      windowRef,
      "https://video.example.test/path",
      videoWindow,
      (available) => results.push(available)
    );
    timeout?.();
    expect(results).toEqual([true, false]);
    expect(videoWindow.postMessage).toHaveBeenCalledTimes(2);
  });

  it("does not arm or post a readiness attempt for same-origin configuration", () => {
    const windowRef = {
      location: { origin: "https://paper.example.test" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn()
    } as unknown as Window;
    const videoWindow = { postMessage: vi.fn() } as unknown as Window;
    const results: boolean[] = [];

    startVideoReadinessAttempt(
      windowRef,
      "https://paper.example.test/video",
      videoWindow,
      (available) => results.push(available)
    );
    expect(results).toEqual([false]);
    expect(windowRef.addEventListener).not.toHaveBeenCalled();
    expect(videoWindow.postMessage).not.toHaveBeenCalled();
  });

  it("keeps a rerendered origin pending until that origin confirms readiness", () => {
    const originA = "https://video-a.example.test";
    const originB = "https://video-b.example.test";
    let readiness = { origin: originA, available: true };

    expect(videoAvailabilityForOrigin(readiness, originA)).toBe(true);

    // Rerender with B while the last accepted result still belongs to A.
    expect(videoAvailabilityForOrigin(readiness, originB)).toBeNull();

    // A late result remains scoped to A and cannot reveal B.
    readiness = { origin: originA, available: true };
    expect(videoAvailabilityForOrigin(readiness, originB)).toBeNull();

    readiness = { origin: originB, available: true };
    expect(videoAvailabilityForOrigin(readiness, originB)).toBe(true);
  });

  it("does not let delayed origin-A cleanup cancel an already-started origin-B attempt", () => {
    const cleanupA = vi.fn();
    const cleanupB = vi.fn();
    const attemptRef = {
      current: {
        origin: "https://video-a.example.test",
        generation: 1,
        cleanup: cleanupA
      }
    };

    cleanupVideoReadinessAttempt(attemptRef);
    expect(cleanupA).toHaveBeenCalledOnce();
    attemptRef.current = {
      origin: "https://video-b.example.test",
      generation: 2,
      cleanup: cleanupB
    };

    cleanupVideoReadinessAttempt(attemptRef, "https://video-a.example.test");
    expect(cleanupB).not.toHaveBeenCalled();
    expect(attemptRef.current?.origin).toBe("https://video-b.example.test");

    cleanupVideoReadinessAttempt(attemptRef, "https://video-b.example.test");
    expect(cleanupB).toHaveBeenCalledOnce();
    expect(attemptRef.current).toBeNull();
  });

  it("promotes accepted external evidence and requires an explicit human decision", () => {
    const markup = renderStage({
      ...initialPublisherState,
      focusProposal: focusRequest,
      auditEvents: [{ type: "focus-requested" }]
    });

    expect(markup).toContain(fixture.evidence.excerpt);
    expect(markup).toContain("40 - 6 = 34");
    expect(markup).toContain(focusRequest.provenance.paper);
    expect(markup).toContain(focusRequest.provenance.video);
    expect(markup).toContain("Confirm focus");
    expect(markup).toContain("Reject focus");
    expect(markup).toContain('data-focus-state="focused"');
    expect(markup).toContain("Restore full workspace");
    expect(markup).toContain('aria-label="Pinned focus context"');
    expect(markup).toContain("Paper evidence");
    expect(markup).toContain("Video evidence");
    expect(markup).toContain("Focus decision");
    expect(markup).toContain('aria-label="Review history"');
    expect(markup).toContain("Focus requested");
  });

  it("renders one persisted blocked discrepancy with linked evidence and reset recovery", () => {
    const discrepancyNote = {
      ...focusRequest,
      id: "discrepancy:paper.methods.final-analysis:video.transcript.calibration-drift"
    };
    const markup = renderStage({
      citationStatus: "blocked",
      discrepancyNote,
      focusProposal: null,
      auditEvents: [
        { type: "focus-requested" },
        { type: "focus-confirmed", confirmedBy: "human" }
      ]
    });

    expect(markup).toContain("Citation status: blocked");
    expect(markup.match(/class="discrepancy-note"/g)).toHaveLength(1);
    expect(markup).toContain('href="#methods-participants"');
    expect(markup).toContain(focusRequest.paperEvidenceId);
    expect(markup).toContain(focusRequest.videoEvidenceId);
    expect(markup).toContain("Reset focus review");
    expect(markup).toContain('aria-label="Review history"');
    expect(markup).toContain("Focus requested");
    expect(markup).toContain("Citation block confirmed by human");
  });

  it("shows a recoverable storage error without claiming the citation was saved or blocked", () => {
    const markup = renderStage(initialPublisherState, "Publisher state could not be saved. Retry the action or reset the review.");

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("could not be saved");
    expect(markup).toContain("Reset failed review");
    expect(markup).not.toContain("Citation status: blocked");
    expect(markup).not.toContain("Discrepancy saved");
  });

  it("labels the Decision chapter with the focus decision heading", () => {
    const markup = renderStage(initialPublisherState);

    expect(markup).toContain('id="chapter-decision" aria-labelledby="focus-decision-title"');
    expect(markup).toContain('<h2 id="focus-decision-title" tabindex="-1">Focus decision</h2>');
    expect(markup).toContain('<h2 id="limitations-title">Limitations</h2>');
  });

  it("renders live exposed WebMCP tool signatures and simulation probe button", () => {
    const activeMarkup = renderToStaticMarkup(
      <PaperApp
        fixture={fixture}
        service={service}
        protocol={{ status: "active", enable: () => undefined, disable: () => undefined }}
      />
    );

    expect(activeMarkup).toContain("Exposed WebMCP Tools (2)");
    expect(activeMarkup).toContain("search_paper_evidence");
    expect(activeMarkup).toContain("request_discrepancy_focus");
    expect(activeMarkup).toContain("Run local service diagnostic");

    const disabledMarkup = renderToStaticMarkup(
      <PaperApp
        fixture={fixture}
        service={service}
        protocol={{ status: "disabled", enable: () => undefined, disable: () => undefined }}
      />
    );

    expect(disabledMarkup).toContain("Exposed WebMCP Tools (0 — Revoked)");
    expect(disabledMarkup).toContain("tool-revoked");
    expect(disabledMarkup).toContain("withdrawn");
  });
});

