/**
 * @bv/sdk — tracking SDK stub (stage 0).
 * Stage 1에서 실제 전송(batch, retry, sendBeacon)을 구현합니다.
 */
export interface TrackEvent {
  name: string;
  properties?: Record<string, unknown>;
  sessionId: string;
}

export interface TrackerOptions {
  endpoint: string;
}

export function createTracker(options: TrackerOptions) {
  return {
    options,
    // TODO(stage1): POST to `${endpoint}/events`
    track(event: TrackEvent): TrackEvent {
      return event;
    },
  };
}
