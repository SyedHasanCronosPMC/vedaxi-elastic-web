import type { ReactElement, ReactNode } from "react";
import type { PublisherAction, PublisherState } from "@vedaxi/state";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => undefined,
    useRef: <T,>(initial: T) => ({ current: initial }),
    useState: <T,>(initial: T) => [initial, vi.fn()] as const
  };
});

import { createPaperEvidenceService, createPaperFixture } from "../paper";
import { CONTROLLED_FOCUS_REQUEST, PaperApp } from "../paper/PaperApp";

interface ElementProps {
  children?: ReactNode;
  onClick?: () => void;
  [key: string]: unknown;
}

function findButton(node: ReactNode, label: string): ReactElement<ElementProps> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findButton(child, label);
      if (match) return match;
    }
    return undefined;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as ReactElement<ElementProps>;
  if (element.type === "button" && element.props.children === label) return element;
  return findButton(element.props.children, label);
}

const fixture = createPaperFixture("https://paper.example.test");
const service = createPaperEvidenceService(fixture.evidence);
const protocol = { status: "unsupported" as const, enable: vi.fn(), disable: vi.fn() };
const initialState: PublisherState = {
  citationStatus: "unblocked",
  discrepancyNote: null,
  focusProposal: null,
  auditEvents: []
};

function tree(state: PublisherState, dispatchPublisher: (action: PublisherAction) => never) {
  return PaperApp({ fixture, service, protocol, publisherState: state, dispatchPublisher });
}

describe("Semantic Focus action boundary", () => {
  it("does not stage local canned evidence when the independent Video is unavailable", async () => {
    const dispatchPublisher = vi.fn(() => { throw new Error("test dispatch"); });
    const button = findButton(tree(initialState, dispatchPublisher), "Run deterministic focus preview");
    expect(button).toBeDefined();
    await button?.props.onClick?.();
    expect(dispatchPublisher).not.toHaveBeenCalled();
  });

  it("maps the human decision controls to exact confirm and reject actions", () => {
    const dispatchPublisher = vi.fn(() => { throw new Error("test dispatch"); });
    const state: PublisherState = {
      ...initialState,
      focusProposal: CONTROLLED_FOCUS_REQUEST,
      auditEvents: [{ type: "focus-requested" }]
    };
    const focusTree = tree(state, dispatchPublisher);

    expect(() => findButton(focusTree, "Confirm focus")?.props.onClick?.()).toThrow("test dispatch");
    expect(dispatchPublisher).toHaveBeenLastCalledWith({
      type: "confirm-focus",
      confirmation: { confirmedBy: "human" }
    });

    expect(() => findButton(focusTree, "Reject focus")?.props.onClick?.()).toThrow("test dispatch");
    expect(dispatchPublisher).toHaveBeenLastCalledWith({ type: "reject-focus" });
  });

  it("resets the persisted discrepancy through the same dispatch closure", () => {
    const dispatchPublisher = vi.fn(() => { throw new Error("test dispatch"); });
    const state: PublisherState = {
      citationStatus: "blocked",
      focusProposal: null,
      discrepancyNote: {
        ...CONTROLLED_FOCUS_REQUEST,
        id: "discrepancy:paper.methods.final-analysis:video.transcript.calibration-drift"
      },
      auditEvents: [
        { type: "focus-requested" },
        { type: "focus-confirmed", confirmedBy: "human" }
      ]
    };

    expect(() => findButton(tree(state, dispatchPublisher), "Reset focus review")?.props.onClick?.()).toThrow("test dispatch");
    expect(dispatchPublisher).toHaveBeenCalledWith({ type: "reset" });
  });

  it("resets an errored review even when no discrepancy was created", () => {
    const dispatchPublisher = vi.fn(() => { throw new Error("test dispatch"); });
    const errorTree = PaperApp({
      fixture,
      service,
      protocol,
      publisherState: initialState,
      dispatchPublisher,
      publisherError: "Publisher state could not be saved."
    });

    expect(() => findButton(errorTree, "Reset failed review")?.props.onClick?.()).toThrow("test dispatch");
    expect(dispatchPublisher).toHaveBeenCalledWith({ type: "reset" });
  });
});
