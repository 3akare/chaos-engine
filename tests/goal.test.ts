import { describe, expect, it } from 'vitest';
import { DEFAULT_CEILING, TIER_SHARE, tierFor, tiersFor } from '../src/shared/goal';
import { ceilingOf } from '../src/server/core/board';
import { machineForDay, PACK } from '../src/shared/pour/pack';

describe('daily goal tiers', () => {
  it('scale with how many played and how hard the machine is', () => {
    expect(tiersFor(1, 100).map((t) => t.need)).toEqual([35, 55, 75, 90]);
    expect(tiersFor(40, 100).map((t) => t.need)).toEqual([1400, 2200, 3000, 3600]);
    // A harder machine (best known 80) asks for less.
    expect(tiersFor(10, 80).map((t) => t.need)).toEqual([280, 440, 600, 720]);
  });

  it('are always reachable: every tier needs less than everyone catching all 100', () => {
    for (const players of [1, 2, 7, 40, 199]) {
      for (const ceiling of [50, 77, 98, 100]) {
        for (const t of tiersFor(players, ceiling)) expect(t.need).toBeLessThanOrEqual(players * 100);
      }
    }
    expect(TIER_SHARE.map((t) => t.name)).toEqual(['Good', 'Great', 'Super', 'Extreme']);
  });

  it('name the highest tier reached', () => {
    const tiers = tiersFor(4, 100); // 140, 220, 300, 360
    expect(tierFor(100, 4, tiers)).toBeNull();
    expect(tierFor(140, 4, tiers)).toBe('Good');
    expect(tierFor(299, 4, tiers)).toBe('Great');
    expect(tierFor(400, 4, tiers)).toBe('Extreme');
    expect(tierFor(0, 0, tiersFor(0, 100))).toBeNull();
  });
});

describe('goal ceiling', () => {
  it('stays on the fixed goal when a better build is found later', () => {
    for (const m of PACK) {
      expect(m.gen?.goal).toBeLessThanOrEqual(m.gen?.best ?? 0);
      expect(ceilingOf(m)).toBe(m.gen?.goal);
    }
    // Repeats (mirrored, reseeded) keep the same goal.
    expect(ceilingOf(machineForDay(PACK.length + 1))).toBe(ceilingOf(machineForDay(1)));
    expect(ceilingOf(null)).toBe(DEFAULT_CEILING);
  });
});

describe('goal strip wording', () => {
  it('says what the community needs next, and how the day finished once closed', async () => {
    const { goalText } = await import('../src/client/lib/goal');
    const t = (players: number, balls: number) => {
      const tiers = tiersFor(players, 80);
      return { players, pours: players, balls, hundreds: 0, tiers, tier: tierFor(balls, players, tiers) };
    };
    expect(goalText(t(0, 0))).toEqual({ label: 'Together', value: '0', note: 'Everyone’s best pour adds up. Be the first!' });
    // 10 players on an 80 machine: Good 280, Great 440, Super 600, Extreme 720.
    expect(goalText(t(10, 300))).toEqual({ label: 'Together · 10 players', value: '300 · Good', note: '140 more for Great' });
    expect(goalText(t(10, 200)).note).toBe('80 more for Good');
    expect(goalText(t(10, 800)).note).toBe('Extreme! The best a day can be.');
    expect(goalText(t(10, 300), true).note).toBe('Finished on Good');
    expect(goalText(t(10, 200), true).note).toBe('Finished short of Good');
    expect(goalText(t(1, 30)).label).toBe('Together · 1 player');
  });
});
