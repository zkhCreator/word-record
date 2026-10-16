// Ebbinghaus-style spaced repetition: a fixed ladder of intervals.
// `stage` indexes the interval the card is currently waiting out.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const INTERVALS = [5 * MIN, 30 * MIN, 12 * HOUR, DAY, 2 * DAY, 4 * DAY, 7 * DAY, 15 * DAY, 30 * DAY, 60 * DAY, 120 * DAY];
export const MAX_STAGE = INTERVALS.length - 1;
/** Cards that survived the 15-day gap count as mastered. */
export const MASTERED_STAGE = 7;

export type Grade = 'again' | 'hard' | 'good';
export const GRADES: Grade[] = ['again', 'hard', 'good'];

export interface ReviewState {
  stage: number;
  due_at: number;
  reps: number;
  lapses: number;
  last_reviewed_at: number | null;
}

export function initialState(now: number): ReviewState {
  return { stage: 0, due_at: now + INTERVALS[0], reps: 0, lapses: 0, last_reviewed_at: null };
}

export function nextStage(stage: number, grade: Grade) {
  if (grade === 'again') return 0;
  if (grade === 'hard') return stage;
  return Math.min(stage + 1, MAX_STAGE);
}

export function schedule(state: ReviewState, grade: Grade, now: number): ReviewState {
  const stage = nextStage(state.stage, grade);
  return {
    stage,
    due_at: now + INTERVALS[stage],
    reps: state.reps + 1,
    lapses: state.lapses + (grade === 'again' ? 1 : 0),
    last_reviewed_at: now,
  };
}

/** Interval (ms) each grade would schedule, for showing on the buttons. */
export function preview(stage: number): Record<Grade, number> {
  return Object.fromEntries(GRADES.map((g) => [g, INTERVALS[nextStage(stage, g)]])) as Record<Grade, number>;
}
