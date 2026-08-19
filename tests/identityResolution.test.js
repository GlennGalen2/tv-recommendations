import assert from 'node:assert/strict'
import {
  createIdentityResolution,
  PRIVATE_STORES,
  undoIdentityResolution
} from '../src/data/privateStore.js'
import {
  confidenceTier,
  createIdentityMatchQuery,
  rankIdentityCandidates
} from '../src/data/identityMatching.js'

const movieQuery = createIdentityMatchQuery({
  title: 'Synthetic Film', type: 'movie', releaseYear: 2024, provenance: { sourceId: 'source:netflix' }
})
const movieCandidates = rankIdentityCandidates(movieQuery, [
  { provider: 'synthetic-provider', externalId: 'movie-1', mediaType: 'movie', canonicalTitle: 'Synthetic Film', releaseYear: 2024 },
  { provider: 'synthetic-provider', externalId: 'movie-2', mediaType: 'movie', canonicalTitle: 'Synthetic Film', releaseYear: 1984 }
])
assert.equal(movieCandidates.length, 1)
assert.equal(movieCandidates[0].score, 1)
assert.equal(confidenceTier(movieCandidates[0].score), 'automatic-eligible')

const seriesQuery = createIdentityMatchQuery({ title: 'Orbit Station', type: 'series' })
const seriesCandidates = rankIdentityCandidates(seriesQuery, [
  { provider: 'synthetic-provider', externalId: 'series-1', mediaType: 'series', canonicalTitle: 'Orbit Station' }
])
assert.equal(seriesCandidates[0].score, 0.8)
assert.equal(confidenceTier(seriesCandidates[0].score), 'review-required')

const episodeQuery = createIdentityMatchQuery(
  { title: 'Orbit Station', type: 'series' },
  [{ mediaScope: { level: 'episode', seasonNumber: 2, episodeNumber: 3, episodeTitle: 'Arrival' } }]
)
const episodeCandidates = rankIdentityCandidates(episodeQuery, [
  { provider: 'synthetic-provider', externalId: 'episode-203', mediaType: 'series', canonicalTitle: 'Orbit Station', seasonNumber: 2, episodeNumber: 3 }
])
assert.equal(episodeCandidates[0].score, 0.99)
assert.equal(confidenceTier(episodeCandidates[0].score), 'review-required')

assert.deepEqual(rankIdentityCandidates(movieQuery, [
  { provider: 'synthetic-provider', externalId: 'same-name-series', mediaType: 'series', canonicalTitle: 'Synthetic Film', releaseYear: 2024 },
  { provider: 'synthetic-provider', externalId: 'other-title', mediaType: 'movie', canonicalTitle: 'Synthetic Film II', releaseYear: 2024 }
]), [])

function request(result) {
  const value = { result, error: null, onsuccess: null, onerror: null }
  queueMicrotask(() => value.onsuccess?.())
  return value
}

function memoryDatabase() {
  const records = new Map()
  return {
    records,
    transaction(storeName) {
      assert.equal(storeName, PRIVATE_STORES.identityResolutions)
      const transaction = { error: null, oncomplete: null, onabort: null, onerror: null }
      transaction.objectStore = () => ({
        get(id) { return request(structuredClone(records.get(id) || null)) },
        add(record) { records.set(record.id, structuredClone(record)) }
      })
      setTimeout(() => transaction.oncomplete?.(), 0)
      return transaction
    }
  }
}

function resolution(id, sourceTitleId, status, supersedesResolutionId = null) {
  return {
    id,
    schemaVersion: 1,
    sourceTitleId,
    status,
    candidate: status === 'unresolved' ? null : {
      provider: 'synthetic-provider', externalId: 'canonical-orbit', mediaType: 'series', canonicalTitle: 'Synthetic Orbit Station'
    },
    confidence: status === 'unresolved' ? 0 : 0.96,
    resolutionMethod: status === 'candidate-match' ? 'provider-search' : 'manual-confirmation',
    rationale: ['Synthetic test evidence.'],
    recordedAt: '2026-08-19T12:00:00.000Z',
    supersedesResolutionId
  }
}

const database = memoryDatabase()
const historyBefore = [{ id: 'evt_immutable', titleId: 'title:source-a', eventType: 'playback' }]
await createIdentityResolution(resolution('resolution-candidate', 'title:source-a', 'candidate-match'), { database })
await createIdentityResolution(resolution('resolution-confirmed', 'title:source-a', 'manually-confirmed', 'resolution-candidate'), { database })
await createIdentityResolution(resolution('resolution-rejected', 'title:source-b', 'manually-rejected'), { database })
await createIdentityResolution(resolution('resolution-other-source', 'title:source-c', 'manually-confirmed'), { database })
const undoneId = await undoIdentityResolution('resolution-confirmed', { database })

assert.equal(database.records.get('resolution-confirmed').status, 'manually-confirmed')
assert.equal(database.records.get('resolution-rejected').status, 'manually-rejected')
assert.equal(database.records.get('resolution-confirmed').candidate.externalId, database.records.get('resolution-other-source').candidate.externalId)
assert.equal(database.records.get(undoneId).status, 'unresolved')
assert.equal(database.records.get(undoneId).supersedesResolutionId, 'resolution-confirmed')
assert.deepEqual(historyBefore, [{ id: 'evt_immutable', titleId: 'title:source-a', eventType: 'playback' }])

console.log('Identity resolution checks passed.')
