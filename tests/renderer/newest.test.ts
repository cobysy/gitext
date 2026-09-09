import { describe, expect, it } from 'vitest';
import { newestOnly } from '@renderer/model/newest.js';

describe('newestOnly', () =>
{
  it('holds while nothing later has started', () =>
  {
    const guard = newestOnly();
    const isNewest = guard.begin();
    expect(isNewest()).toBe(true);
    expect(isNewest()).toBe(true);
  });

  it('drops a request once a later one begins', () =>
  {
    const guard = newestOnly();
    const first = guard.begin();
    const second = guard.begin();

    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('never lets a superseded request come back, even if it finishes last', () =>
  {
    const guard = newestOnly();
    const first = guard.begin();
    const second = guard.begin();
    second();

    expect(first()).toBe(false);
  });

  it('counts each guard on its own, so two loaders do not cancel each other', () =>
  {
    const files = newestOnly();
    const patch = newestOnly();
    const filesRead = files.begin();
    patch.begin();

    expect(filesRead()).toBe(true);
  });
});
