// test/e2e/helpers/mock-credential-store.ts

export interface StoredCredential {
  macaroon: string
  preimage: string
  paymentHash: string
  creditBalance: number | null
  storedAt: string
  lastUsed: string
  server: 'toll-booth' | null
}

/**
 * In-memory credential store matching the interface that handleFetch uses.
 * Avoids filesystem I/O and keychain access that CredentialStore requires.
 */
export class InMemoryCredentialStore {
  private data = new Map<string, StoredCredential>()

  get(origin: string): StoredCredential | undefined {
    return this.data.get(origin)
  }

  set(origin: string, credential: StoredCredential): void {
    this.data.set(origin, credential)
  }

  delete(origin: string): void {
    this.data.delete(origin)
  }

  updateBalance(origin: string, balance: number): void {
    const cred = this.data.get(origin)
    if (cred) cred.creditBalance = balance
  }

  updateLastUsed(origin: string): void {
    const cred = this.data.get(origin)
    if (cred) cred.lastUsed = new Date().toISOString()
  }
}
