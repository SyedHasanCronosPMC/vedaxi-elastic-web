# VEDAXI

VEDAXI is a two-origin WebMCP research-integrity desk. A Paper publisher and an independent Video publisher expose bounded evidence tools. An agent may search evidence and request a discrepancy focus; only a human can confirm or reject that proposal. All research content is fictional fixture data.

Public GitHub: [luxurylifestyleco/vedaxi-elastic-web](https://github.com/luxurylifestyleco/vedaxi-elastic-web)

## Current state (HEAD)

| Area | Reality |
| --- | --- |
| License | MIT. Root [`LICENSE`](LICENSE). |
| Paper (`apps/paper`) | Editorial desk at `http://localhost:4173`. Tools: `search_paper_evidence` (read-only), `request_discrepancy_focus` (proposal only). |
| Video (`apps/video`) | Independent origin at `http://localhost:4174`. Tools: `search_video_evidence`, `read_video_transcript`. Human seek targets `00:03:12` (192s). |
| Shared state | `@vedaxi/state` `PublisherStore.dispatch` is the only mutation boundary. Confirm/reject/reset persist through that API. |
| M0 | Recorded `PASS`. |
| M1–M4 | Local testing is finished (Paper, Video/MP4+VTT, shared actions, stage). Registry JSON still has no recorded module `PASS` except M0; that is not “work unstarted.” |
| Deployment | Configure each publisher with the other origin; verify the live workflow after deployment. |
| CI | GitHub Actions Ubuntu job installs FFmpeg, then `node evals/run-quality-gate.mjs --clean-install`. |

Paper and Video are independent Vercel apps. A deployment is accepted only after the connected review and human decision are verified on its actual origins.

`.devpost-hackathon-state.json` stays `rules_acknowledged: false` until the project owner acknowledges the rules.

## Public hosting (Vercel)

The live production deployments are verified, aliased, and accessible:

| Surface | Live Production URL | Description |
| :--- | :--- | :--- |
| **Research Integrity Desk** | **[https://vedaxi-integrity-desk.vercel.app](https://vedaxi-integrity-desk.vercel.app)** | Primary interactive WebMCP product, Dev Console, Light/Dark mode, and 3D Constellation |
| **Protocol Edition Story Map** | **[https://vedaxi-protocol-edition.vercel.app](https://vedaxi-protocol-edition.vercel.app)** | Cinematic 3D GSAP pinned storytelling map & multi-origin matrix |
| **Video Evidence Origin** | **[https://vedaxi-video-origin-teal.vercel.app](https://vedaxi-video-origin-teal.vercel.app)** | Independent Video publisher with timed evidence at `00:03:12` |
| **Research Desk Alias** | **[https://vedaxi-research-desk.vercel.app](https://vedaxi-research-desk.vercel.app)** | Production alternative alias |

Until those exist, run locally at `http://localhost:4173` (Paper) and `http://localhost:4174` (Video).

## Controlled evidence video

This is the in-product M2 evidence asset already in the repository (not a YouTube demo):

<video src="apps/video/public/media/vedaxi-controlled-evidence.mp4" controls width="640"></video>

- Video: [`apps/video/public/media/vedaxi-controlled-evidence.mp4`](apps/video/public/media/vedaxi-controlled-evidence.mp4)
- Captions: [`apps/video/public/media/vedaxi-controlled-evidence.vtt`](apps/video/public/media/vedaxi-controlled-evidence.vtt)
- Contract: [`docs/assets/M2/media-manifest.json`](docs/assets/M2/media-manifest.json) (`READY_FOR_VALIDATION`)

GitHub may not inline-play large MP4s; the files are the source of truth in this repo.

## Repository map

```text
apps/paper/           Paper Integrity Desk + Semantic Stage
apps/video/           Independent Video publisher
apps/protocol-probe/  Minimal native WebMCP diagnostic fixture
packages/contracts/   Shared evidence and WebMCP contracts
packages/state/       Shared persistent publisher state
evals/                Quality gate, claim integrity, M2 media validator
docs/                 Architecture, evidence, compliance, release registry
```

## Run locally

Needs Node.js 22 and npm. FFmpeg/`ffprobe` is required only when validating a real MP4 (`READY_FOR_VALIDATION`).

```bash
npm ci
npm run dev:paper    # http://localhost:4173
npm run dev:video    # http://localhost:4174
```

Production preview of a built shell:

```bash
npm run build:paper && npm run preview:paper
npm run build:video && npm run preview:video
```

Cross-origin env (public origins, not secrets). Copy the examples:

```text
apps/paper/.env.example   →  VITE_VIDEO_ORIGIN=http://localhost:4174
apps/video/.env.example   →  VITE_PAPER_ORIGIN=http://localhost:4173
```

Production Paper builds must set `VITE_VIDEO_ORIGIN`; Video builds must set `VITE_PAPER_ORIGIN`.

```bash
npm test
npm run quality:local
npm run status:release
node evals/validate-m2-media-slot.mjs
```

`quality:local` type-checks, runs tests, builds Paper/Video/probes, and checks registries. GitHub runs the same script with `--clean-install` after installing `ffmpeg` so `ffprobe` is on PATH.

## M2 media contract

| Artifact | Path | HEAD |
| --- | --- | --- |
| Video | `apps/video/public/media/vedaxi-controlled-evidence.mp4` | Present (H.264/AAC, duration 210s) |
| Captions | `apps/video/public/media/vedaxi-controlled-evidence.vtt` | Present (cue at `00:03:12` includes `six` and `did not replace`) |
| Manifest | `docs/assets/M2/media-manifest.json` | `READY_FOR_VALIDATION` |

`node evals/validate-m2-media-slot.mjs` exits `0` when `ffprobe` is available. That is slot validity, not a recorded M2 module `PASS` and not the Devpost `<180s` demo.

## WebMCP tools

| Origin | Tool | Role |
| --- | --- | --- |
| Paper | `search_paper_evidence` | Read-only publisher evidence |
| Paper | `request_discrepancy_focus` | Creates a focus proposal only |
| Video | `search_video_evidence` | Read-only transcript evidence |
| Video | `read_video_transcript` | Read-only cue dump |

Publisher output must not contain derived `34`, contradiction labels, or the other origin's state. Kill-switch unregisters tools without removing the human reading path.

## Safety

Prototype only. Not a medical or scientific decision system. The tool cannot block a citation without an explicit human confirm.

## License

[MIT](LICENSE) — Copyright (c) 2026 COdy Shah and VEDAXI Contributors.

## Connected review and verification boundaries

The guided comparison awaits a reply from the configured Video origin over an explicit, read-only browser message bridge. It validates origin, sender window, request ID and evidence identity; unavailable or disabled publishers cannot produce a successful result. This bridge is distinct from native WebMCP registration. Native tools remain available only in supporting browsers. No HTTP `/api/webmcp` endpoint or model inference is provided.

Only the canonical fictional 40-participant study is connected. Previous secondary scenarios used local predetermined outcomes and are not exposed as verified cross-origin runs. Received passages support the bounded 40 - 6 comparison; a failed or changed passage requires human review. A proposal alone does not block a citation. Human Confirm blocks it; Reject dismisses the proposal. Decisions persist in this browser's local storage, not a shared database. The 3D map and static dossier are illustrative.

Deploy `apps/paper` and `apps/video` from the same reviewed Git revision. Set Paper `VITE_VIDEO_ORIGIN` and Video `VITE_PAPER_ORIGIN` to the canonical independent production URLs, then redeploy both. These values are public origins, not secrets. Do not connect either publisher to an unreviewed account's origin by fallback.
