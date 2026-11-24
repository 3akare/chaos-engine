import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../src/shared/fixtures';
import { validateMachine } from '../src/shared/generator/validate';

describe('fixtures', () => {
  it('there are five', () => expect(FIXTURES).toHaveLength(5));
  for (const m of FIXTURES) {
    it(`${m.name} passes §5.3`, () => {
      const v = validateMachine(m, { tier: m.gen!.tier, redOnly: true });
      expect(v.reason).toBe('ok');
      expect(v.ok).toBe(true);
    });
  }
});
