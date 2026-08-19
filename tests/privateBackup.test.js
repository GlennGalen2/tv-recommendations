import assert from 'node:assert/strict'
import {
  PRIVATE_BACKUP_FORMAT,
  PRIVATE_STORES,
  createPrivateBackup,
  inspectPrivateBackupJson,
  parsePrivateBackupJson,
  restorePrivateBackup,
  validatePrivateBackup
} from '../src/data/privateStore.js'

const storeNames = Object.values(PRIVATE_STORES)

function syntheticRecords() {
  const records = Object.fromEntries(storeNames.map(name => [name, []]))
  records.metadata.push({ key: 'recordSchemaVersion', value: 1 })
  records.viewers.push({ id: 'viewer-1', schemaVersion: 1, displayName: 'Viewer 1', active: true })
  records.titles.push({ id: 'title:synthetic-film', schemaVersion: 1, type: 'movie', title: 'Synthetic Film' })
  records.sources.push({ id: 'source:manual', schemaVersion: 1, name: 'Synthetic manual', kind: 'manual' })
  records.importBatches.push({ id: 'import:synthetic', schemaVersion: 1, sourceId: 'source:manual' })
  records.historyEvents.push({
    id: 'evt_synthetic', schemaVersion: 1, viewerIds: ['viewer-1'], titleId: 'title:synthetic-film',
    eventType: 'playback', provenance: { sourceId: 'source:manual', importBatchId: 'import:synthetic' }
  })
  records.reactions.push({
    id: 'rct_synthetic', schemaVersion: 1, viewerId: 'viewer-1', titleId: 'title:synthetic-film',
    reaction: 'liked', provenance: { sourceId: 'source:manual' }
  })
  records.preferenceEvidence.push({ id: 'evidence_synthetic', schemaVersion: 1, viewerId: 'viewer-1' })
  records.recommendations.push({ id: 'rec_synthetic', schemaVersion: 1, titleId: 'title:synthetic-film' })
  return records
}

function createMemoryDatabase(initialRecords, failStoreName) {
  let state = structuredClone(initialRecords)

  return {
    snapshot: () => structuredClone(state),
    transaction(storeNames) {
      const draft = structuredClone(state)
      const transaction = {
        error: null,
        onabort: null,
        oncomplete: null,
        onerror: null,
        objectStore(storeName) {
          assert.equal(storeNames.includes(storeName), true)
          return {
            clear() {
              draft[storeName] = []
            },
            add(record) {
              if (storeName === failStoreName) {
                transaction.error = new Error('Synthetic transaction failure')
                return
              }
              draft[storeName].push(structuredClone(record))
            }
          }
        }
      }

      queueMicrotask(() => {
        if (transaction.error) {
          transaction.onabort?.()
        } else {
          state = draft
          transaction.oncomplete?.()
        }
      })
      return transaction
    }
  }
}

const records = syntheticRecords()
const backup = createPrivateBackup(records, '2026-08-19T12:00:00.000Z')

assert.equal(backup.format, PRIVATE_BACKUP_FORMAT)
assert.equal(backup.recordCounts.historyEvents, 1)
assert.equal(backup.records.historyEvents[0].id, 'evt_synthetic')
assert.equal(validatePrivateBackup(backup).valid, true)
assert.deepEqual(parsePrivateBackupJson(JSON.stringify(backup)).backup, backup)

const database = createMemoryDatabase(Object.fromEntries(storeNames.map(name => [name, [{ id: `old-${name}`, schemaVersion: 1 }]])))
const restored = await restorePrivateBackup(backup, { database })
assert.deepEqual(restored.recordCounts, backup.recordCounts)
assert.deepEqual(database.snapshot(), records)

const malformed = { ...backup, format: 'not-a-private-backup' }
assert.equal(validatePrivateBackup(malformed).valid, false)
assert.deepEqual(inspectPrivateBackupJson(JSON.stringify(malformed)).validation.problems, [
  'Backup format marker is not recognized.'
])
assert.throws(() => parsePrivateBackupJson('{bad json'), /not valid JSON/)
assert.throws(() => parsePrivateBackupJson(JSON.stringify(malformed)), /not a compatible/)

const incompatible = { ...backup, formatVersion: 3 }
assert.equal(validatePrivateBackup(incompatible).valid, false)

const versionOneRecords = structuredClone(backup.records)
delete versionOneRecords.identityResolutions
const versionOneCounts = { ...backup.recordCounts }
delete versionOneCounts.identityResolutions
const compatibleVersionOne = {
  ...backup,
  formatVersion: 1,
  databaseVersion: 1,
  recordCounts: versionOneCounts,
  records: versionOneRecords
}
assert.equal(validatePrivateBackup(compatibleVersionOne).valid, true)
const versionOneDatabase = createMemoryDatabase(Object.fromEntries(storeNames.map(name => [name, []])))
await restorePrivateBackup(compatibleVersionOne, { database: versionOneDatabase })
assert.deepEqual(versionOneDatabase.snapshot().identityResolutions, [])
assert.equal(versionOneDatabase.snapshot().historyEvents[0].id, 'evt_synthetic')

const beforeFailedRestore = database.snapshot()
const failedDatabase = createMemoryDatabase(beforeFailedRestore, PRIVATE_STORES.historyEvents)
await assert.rejects(restorePrivateBackup(backup, { database: failedDatabase }), /transaction failure/)
assert.deepEqual(failedDatabase.snapshot(), beforeFailedRestore)

console.log('Private backup export and restore checks passed.')
