import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../dev/harness/memory-store';

describe('MemoryStore transactions', () => {
  it('commits when watched keys are untouched', async () => {
    const s = new MemoryStore();
    const tx = await s.watch('a');
    await tx.multi();
    await tx.hSet('a', { x: '1' });
    await tx.zAdd('z', { member: 'm', score: 1 });
    expect(await tx.exec()).not.toBeNull();
    expect(await s.hGet('a', 'x')).toBe('1');
    expect(await s.zCard('z')).toBe(1);
  });
  it('aborts when a watched key changes before EXEC', async () => {
    const s = new MemoryStore();
    const tx = await s.watch('a');
    await s.hSet('a', { y: '2' });
    await tx.multi();
    await tx.hSet('a', { x: '1' });
    expect(await tx.exec()).toBeNull();
    expect(await s.hGet('a', 'x')).toBeUndefined();
  });
  it('set nx + expiration behaves like a lease', async () => {
    let t = 1000;
    const s = new MemoryStore(() => t);
    await s.set('l', 'one', { nx: true, expiration: new Date(2000) });
    await s.set('l', 'two', { nx: true, expiration: new Date(3000) });
    expect(await s.get('l')).toBe('one');
    t = 2500;
    expect(await s.get('l')).toBeUndefined();
  });
});
