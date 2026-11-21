import type { Rng } from '../rng';

const NAMES: Record<string, string[]> = {
  drop: ['Switchback', 'Wrong Way Ledge', 'Hairpin', 'Detour', 'Double Back'],
  gap: ['Mind the Gap', 'Leap of Faith', 'Canyon Hop', 'Long Jump', 'Pit Stop'],
  gate: ['Locked Gate', 'The Toll Booth', 'Back Door', 'Key Master', 'Gatekeeper'],
  launch: ['Launch Pad', 'Up and Over', 'Skyward', 'Liftoff', 'High Step'],
  fan: ['Fan Corridor', 'Wind Tunnel', 'Tailwind', 'Breezeway', 'Draft Dodger'],
  finish: ['Last Turn', 'Photo Finish', 'Final Approach', 'Home Stretch'],
  funnel: ['The Chute'],
};

/** Name from the dominant band family (§5.1); ties go to the earliest band. */
export function machineName(rng: Rng, families: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const f of families) counts.set(f, (counts.get(f) ?? 0) + 1);
  let best = families[0] ?? 'funnel';
  for (const f of families) if ((counts.get(f) ?? 0) > (counts.get(best) ?? 0)) best = f;
  return rng.pick(NAMES[best] ?? NAMES.funnel!);
}
