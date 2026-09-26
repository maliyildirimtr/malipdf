/** Starts Ink Replay on one page. detail: { docId, pageIndex } */
export const REPLAY_INK_EVENT = 'malipdf:replay-ink';
export interface ReplayInkDetail {
  docId: string;
  pageIndex: number;
}
