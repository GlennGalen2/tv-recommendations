import assert from 'node:assert/strict'
import {
  clearTmdbReadAccessToken,
  getTmdbCredentialStatus,
  getTmdbReadAccessToken,
  saveTmdbReadAccessToken
} from '../src/data/tmdbCredentialStore.js'
import { PRIVATE_STORES, createPrivateBackup } from '../src/data/privateStore.js'

function request(result) {
  const value = { result, error: null, onsuccess: null, onerror: null }
  queueMicrotask(() => value.onsuccess?.())
  return value
}

function memoryCredentialDatabase() {
  const records = new Map()
  return {
    transaction(storeName) {
      assert.equal(storeName, 'credentials')
      const transaction = { error: null, oncomplete: null, onabort: null, onerror: null }
      transaction.objectStore = () => ({
        get(key) { return request(structuredClone(records.get(key) || null)) },
        put(record) { records.set(record.key, structuredClone(record)) },
        delete(key) { records.delete(key) }
      })
      setTimeout(() => transaction.oncomplete?.(), 0)
      return transaction
    }
  }
}

const database = memoryCredentialDatabase()
const syntheticToken = 'synthetic-read-access-token-only-for-test'

assert.deepEqual(await getTmdbCredentialStatus({ database }), { configured: false })
await saveTmdbReadAccessToken(`  ${syntheticToken}  `, { database })
assert.deepEqual(await getTmdbCredentialStatus({ database }), { configured: true })
assert.equal(await getTmdbReadAccessToken({ database }), syntheticToken)
await clearTmdbReadAccessToken({ database })
assert.deepEqual(await getTmdbCredentialStatus({ database }), { configured: false })
assert.equal(await getTmdbReadAccessToken({ database }), null)

const backupRecords = Object.fromEntries(Object.values(PRIVATE_STORES).map(storeName => [storeName, []]))
backupRecords.metadata.push({ key: 'recordSchemaVersion', value: 1 })
const backup = createPrivateBackup(backupRecords, '2026-08-19T12:00:00.000Z')
assert.equal('credentials' in backup.records, false)
assert.equal(JSON.stringify(backup).includes(syntheticToken), false)

console.log('TMDb credential-store checks passed.')
