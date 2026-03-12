import { describe, it, expect } from 'vitest'
import { CapacityTracker } from './capacity.js'

describe('CapacityTracker', () => {
  it('allows requests under limit', () => {
    const tracker = new CapacityTracker(2)
    expect(tracker.tryAcquire()).toBe(true)
    expect(tracker.active).toBe(1)
  })

  it('rejects requests at limit', () => {
    const tracker = new CapacityTracker(2)
    expect(tracker.tryAcquire()).toBe(true)
    expect(tracker.tryAcquire()).toBe(true)
    expect(tracker.tryAcquire()).toBe(false)
    expect(tracker.active).toBe(2)
  })

  it('allows requests after release', () => {
    const tracker = new CapacityTracker(1)
    expect(tracker.tryAcquire()).toBe(true)
    expect(tracker.tryAcquire()).toBe(false)
    tracker.release()
    expect(tracker.tryAcquire()).toBe(true)
  })

  it('allows unlimited when maxConcurrent is 0', () => {
    const tracker = new CapacityTracker(0)
    for (let i = 0; i < 100; i++) {
      expect(tracker.tryAcquire()).toBe(true)
    }
    expect(tracker.active).toBe(100)
  })

  it('does not go below zero on extra release', () => {
    const tracker = new CapacityTracker(2)
    tracker.release()
    expect(tracker.active).toBe(0)
  })
})
