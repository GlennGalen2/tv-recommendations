import assert from 'node:assert/strict'
import {
  PRIVATE_STORES,
  removePrivateImportBatch
} from '../src/data/privateStore.js'

const storeNames = Object.values(PRIVATE_STORES)

function request(result) {
  const value = {}
  queueMicrotask(() => {
    value.result = structuredClone(result)
    value.onsuccess?.()
  })
  return value
}

function createMemoryDatabase(initialRecords, failDeleteId) {
  let state = structuredClone(initialRecords)

  return {
    snapshot: () => structuredClone(state),
    transaction(names) {
      const draft = structuredClone(state)
      const transaction = {
        error: null,
        onabort: null,
        oncomplete: null,
        onerror: null,
        objectStore(name) {
          assert.equal(names.includes(name), true)
          const identityKey = name === PRIVATE_STORES.metadata ? 'key' : 'id'
          return {
            get(id) {
              return request(draft[name].find(record => record[identityKey] === id))
            },
            getAll() {
              return request(draft[name])
            },
            delete(id) {
              if (id === failDeleteId) {
                transaction.error = new Error('Synthetic transaction failure')
                return
              }
              draft[name] = draft[name].filter(record => record[identityKey] !== id)
            }
          }
        }
      }
      setTimeout(() => {
        if (transaction.error) transaction.onabort?.()
        else {
          state = draft
          transaction.oncomplete?.()
        }
      }, 0)
      return transaction
    }
  }
}

function records() {
  const result = Object.fromEntries(storeNames.map(name => [name, []]))
  result.importBatches.push(
    { id: 'import:test-batch', schemaVersion: 1, sourceId: 'source:netflix' },
    { id: 'import:real-batch', schemaVersion: 1, sourceId: 'source:netflix' }
  )
  result.historyEvents.push(
    { id: 'evt-test-shared', schemaVersion: 1, titleId: 'title:shared', provenance: { importBatchId: 'import:test-batch' } },
    { id: 'evt-test-orphan', schemaVersion: 1, titleId: 'title:orphan', provenance: { importBatchId: 'import:test-batch' } },
    { id: 'evt-test-protected', schemaVersion: 1, titleId: 'title:protected', provenance: { importBatchId: 'import:test-batch' } },
    { id: 'evt-real-shared', schemaVersion: 1, titleId: 'title:shared', provenance: { importBatchId: 'import:real-batch' } }
  )
  result.titles.push(
    { id: 'title:shared', schemaVersion: 1 },
    { id: 'title:orphan', schemaVersion: 1 },
    { id: 'title:protected', schemaVersion: 1 },
    { id: 'title:unrelated', schemaVersion: 1 }
  )
  result.reactions.push({ id: 'reaction:protected', schemaVersion: 1, titleId: 'title:protected', viewerId: 'viewer-1', reaction: 'liked' })
  result.sources.push({ id: 'source:netflix', schemaVersion: 1 })
  return result
}

const database = createMemoryDatabase(records())
const result = await removePrivateImportBatch('import:test-batch', { database })
assert.deepEqual(result, {
  removedBatchId: 'import:test-batch',
  removedHistoryEvents: 3,
  removedTitles: 1
})
const afterRemoval = database.snapshot()
assert.deepEqual(afterRemoval.importBatches.map(batch => batch.id), ['import:real-batch'])
assert.deepEqual(afterRemoval.historyEvents.map(event => event.id), ['evt-real-shared'])
assert.deepEqual(afterRemoval.titles.map(title => title.id).sort(), [
  'title:protected', 'title:shared', 'title:unrelated'
])
assert.equal(afterRemoval.reactions.length, 1)

const beforeFailure = records()
const failingDatabase = createMemoryDatabase(beforeFailure, 'evt-test-orphan')
await assert.rejects(
  removePrivateImportBatch('import:test-batch', { database: failingDatabase }),
  /transaction failure/
)
assert.deepEqual(failingDatabase.snapshot(), beforeFailure)

console.log('Import batch maintenance checks passed.')
