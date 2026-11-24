/** The weekly difficulty rhythm (§5.4). */
import { utcWeekday } from '../day';
import type { PieceType } from '../types';

export type DayPlan = {
  tier: 1 | 2 | 3;
  gate: 'optional' | 'likely' | 'required';
  /** Number of checkpoints (0 = plain DELIVER). */
  checkpoints: number;
  springFanWeighted: boolean;
  avoidStartX?: number | undefined;
  /** Pieces the day's solution must use, so days feel different (dropped if it can't be built). */
  require?: PieceType[] | undefined;
};

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Mon/Tue tier 1 · Wed/Thu tier 2 · Fri tier 3 · Sat tier 3 + checkpoints · Sun tier 2, springs & fans. */
/** The featured piece(s) per weekday: Sun spring · Mon fan · Tue spring · Wed fan · Thu spring · Fri spring+fan · Sat fan. */
const FEATURE: PieceType[][] = [['SPRING'], ['FAN'], ['SPRING'], ['FAN'], ['SPRING'], ['SPRING', 'FAN'], ['FAN']];

export function planForWeekday(weekday: number): DayPlan {
  return { ...basePlan(weekday), require: FEATURE[weekday] };
}

function basePlan(weekday: number): DayPlan {
  switch (weekday) {
    case 1:
    case 2:
      return { tier: 1, gate: 'optional', checkpoints: 0, springFanWeighted: false };
    case 3:
    case 4:
      return { tier: 2, gate: 'likely', checkpoints: 0, springFanWeighted: false };
    case 5:
      return { tier: 3, gate: 'required', checkpoints: 0, springFanWeighted: false };
    case 6:
      return { tier: 3, gate: 'required', checkpoints: 2, springFanWeighted: false };
    default:
      return { tier: 2, gate: 'optional', checkpoints: 0, springFanWeighted: true };
  }
}

export const planForOpenTime = (openMs: number): DayPlan => planForWeekday(utcWeekday(openMs));
