import { useRef, useState } from "react";
import { VIDEO_EVIDENCE_SECONDS, VIDEO_EVIDENCE_TIMESTAMP, type VideoFixture } from "./fixture";
import type { VideoEvidenceService } from "./service";
import { seekVideo, type SeekResult } from "./seek";
import { protocolStatusCopy } from "./protocol-status";
import type { VideoProtocolControls } from "./use-video-registration";

interface VideoAppProps {
  fixture: VideoFixture;
  service: VideoEvidenceService;
  protocol: VideoProtocolControls;
}

export function VideoApp({ fixture, service, protocol }: VideoAppProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [result, setResult] = useState<SeekResult | null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ReturnType<VideoEvidenceService["search"]> | null>(null);
  const transcript = service.readTranscript();

  const seek = async () => setResult(await seekVideo(video.current, { seconds: VIDEO_EVIDENCE_SECONDS }));
  const mediaStatus = mediaError
    ? "Video media is unavailable. Transcript evidence remains available below."
    : result
      ? result.ok
        ? `Seek confirmed at ${result.seconds} seconds.`
        : result.message
      : mediaReady
        ? "Video metadata loaded. Evidence seek is available."
        : "Video media has not loaded. Evidence seek is unavailable; the transcript remains readable below.";

  return (
    <>
      <a className="skip" href="#content">Skip to video evidence</a>
      <header>
        <span className="mark" aria-hidden="true">
          <img src="/brand/vdx-mark.svg" alt="" width="18" height="18" className="identity__icon" />
        </span>
        <span>VEDAXI</span>
        <span className="origin">Independent video origin · {fixture.evidence.sourceOrigin}</span>
      </header>
      <main id="content">
        <section className="intro">
          <p className="eyebrow">Video evidence origin</p>
          <h1>Calibration drift, in the speaker’s own record.</h1>
          <p>Read the transcript and inspect the exact moment. This publisher exposes evidence only; it does not interpret the paper.</p>
          <div className="protocol">
            <span id="protocol-status" role="status" aria-live="polite" aria-atomic="true" data-status={protocol.status}>
              {protocolStatusCopy(protocol.status)}
            </span>
            <button type="button" aria-describedby="protocol-status" onClick={protocol.status === "active" || protocol.status === "unsupported" ? protocol.disable : protocol.enable}>
              {protocol.status === "active" || protocol.status === "unsupported" ? "Turn publisher access off" : "Enable publisher access"}
            </button>
            <p>The publisher switch controls both native tools and the guided evidence bridge. Human transcript reading remains available.</p>
          </div>
        </section>

        <section className="player" aria-labelledby="player-title">
          <h2 id="player-title">Recorded source</h2>
          <video
            ref={video}
            aria-label="Recorded source video: calibration drift evidence"
            controls
            preload="metadata"
            src={fixture.mediaSrc}
            onLoadedMetadata={() => { setMediaReady(true); setMediaError(false); }}
            onError={() => { setMediaReady(false); setMediaError(true); }}
          >
            <track kind="captions" src={fixture.captionsSrc} srcLang="en" label="English" default />
          </video>
          <p id="media-status" className="media-state" role="status" aria-live="polite" aria-atomic="true">{mediaStatus}</p>
          <button
            type="button"
            onClick={seek}
            disabled={!mediaReady}
            aria-describedby="media-status"
            aria-label="Seek to calibration drift evidence at 3 minutes 12 seconds"
          >
            Jump to {VIDEO_EVIDENCE_TIMESTAMP} evidence
          </button>
        </section>

        <section className="transcript" aria-labelledby="transcript-title">
          <div><p className="eyebrow">Publisher transcript</p><h2 id="transcript-title">Exact evidence</h2></div>
          <form onSubmit={(event) => { event.preventDefault(); setMatches(service.search(query)); }}>
            <label htmlFor="query">Search video transcript</label>
            <div className="search-row">
              <input id="query" type="search" value={query} maxLength={160} autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
              <button type="submit">Search</button>
            </div>
          </form>
          <p role="status" aria-live="polite" aria-atomic="true">
            {matches === null ? "Search the publisher transcript." : matches.length ? `${matches.length} matching evidence result.` : "No matching video evidence."}
          </p>
          {matches?.map((match) => (
            <p className="match" key={match.evidence.id}>
              {match.evidence.excerpt}<small>{match.evidence.locator} · {match.evidence.sourceOrigin}</small>
            </p>
          ))}
          {transcript.cues.map((cue) => (
            <article key={cue.start}>
              <button
                type="button"
                disabled={!mediaReady}
                aria-describedby="media-status"
                aria-label={`Seek video to transcript evidence at ${VIDEO_EVIDENCE_TIMESTAMP}`}
                onClick={() => void seekVideo(video.current, { seconds: VIDEO_EVIDENCE_SECONDS }).then(setResult)}
              >
                <time>{VIDEO_EVIDENCE_TIMESTAMP}</time>
              </button>
              <p>{cue.text}</p>
            </article>
          ))}
          <aside aria-label="Evidence provenance">
            <strong>Evidence provenance</strong>
            <span>ID: {transcript.evidence.id}</span><span>Origin: {transcript.evidence.sourceOrigin}</span><span>Locator: {transcript.evidence.locator}</span>
          </aside>
        </section>
      </main>
      <footer>VEDAXI / source evidence before inference</footer>
    </>
  );
}
