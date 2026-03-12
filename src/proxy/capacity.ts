/**
 * Tracks concurrent inference requests.
 * maxConcurrent of 0 means unlimited.
 */
export class CapacityTracker {
  private _active = 0
  constructor(readonly maxConcurrent: number) {}

  get active(): number {
    return this._active
  }

  /** Returns true if a slot was acquired, false if at capacity. */
  tryAcquire(): boolean {
    if (this.maxConcurrent > 0 && this._active >= this.maxConcurrent) {
      return false
    }
    this._active++
    return true
  }

  /** Releases a slot. */
  release(): void {
    if (this._active > 0) this._active--
  }
}
