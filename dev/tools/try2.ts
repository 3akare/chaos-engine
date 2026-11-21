import { grid, pc, run } from '../../tests/helpers';
import { renderAscii } from '../../src/shared/sim';
const l = grid(['S', '', '.T', '#########']);
const ps = [pc('RAMP', 'DR', 0, 1)];
const r = run(l, ps);
console.log(renderAscii(l, ps, r)); console.log(r.frames.map(f=>`${f.x},${f.y}`).join(' '));
