import assert from 'node:assert/strict'
import {
  filterAndSortIdentityReviewQueue,
  paginateIdentityReviewQueue,
  runTmdbIdentityReviewQueueFromRecords
} from '../src/data/tmdbMatchingPilot.js'

const sources = [{ id: 'source:netflix', name: 'Netflix' }, { id: 'source:amazon-prime-video', name: 'Amazon Prime Video' }]
const titles = [
  { id: 'title:movie', type: 'movie', title: 'Synthetic Movie', originalTitle: 'Synthetic Movie' },
  { id: 'title:series', type: 'unknown', title: 'Synthetic Series - Season 1', originalTitle: 'Synthetic Series - Season 1' },
  { id: 'title:missing', type: 'unknown', title: 'Synthetic Missing', originalTitle: 'Synthetic Missing' },
  { id: 'title:confirmed', type: 'unknown', title: 'Synthetic Confirmed', originalTitle: 'Synthetic Confirmed' }
]
const events = titles.map((title, index) => ({
  id: `event-${index}`, titleId: title.id, eventType: 'playback', occurredOn: '2026-01-01', mediaScope: { level: 'title' },
  observations: { sourceTitle: title.originalTitle }, provenance: { sourceId: title.id === 'title:series' ? 'source:amazon-prime-video' : 'source:netflix' }
}))
const resolutions = [{
  id: 'resolution-confirmed', schemaVersion: 1, sourceTitleId: 'title:confirmed', status: 'manually-confirmed', confidence: 0.8,
  candidate: { provider: 'synthetic', externalId: 'confirmed-1', mediaType: 'series', canonicalTitle: 'Synthetic Confirmed', score: 0.8, reasons: ['Synthetic confirmation.'] },
  resolutionMethod: 'manual-confirmation', rationale: ['Synthetic confirmation.'], recordedAt: '2026-01-02T00:00:00.000Z', supersedesResolutionId: null
}]
const records = { titles, events, sources, resolutions }
const before = structuredClone(records)

const searchCandidates = async ({ query, mediaTypes }) => {
  if (query === 'Synthetic Missing') return []
  return [{ provider: 'tmdb', externalId: `${query}-1`, mediaType: mediaTypes[0], canonicalTitle: query, releaseDate: '2020-01-01', releaseYear: 2020 }]
}
const queue = await runTmdbIdentityReviewQueueFromRecords(records, { searchCandidates, throttleMs: 0 })
assert.equal(queue.eligibleCount, 3)
assert.equal(queue.processedCount, 3)
assert.equal(queue.counts['needs-review'], 2)
assert.equal(queue.counts.unresolved, 1)
assert.equal(queue.counts.confirmed, 1)
assert.equal(queue.counts.normalizedLookups, 1)
assert.equal(queue.pendingTitleIds.length, 0)
assert.deepEqual(records, before)

const reviewItems = filterAndSortIdentityReviewQueue(queue.items, { category: 'needs-review', sort: 'title' })
assert.equal(reviewItems.length, 2)
const page = paginateIdentityReviewQueue(reviewItems, 0, 1)
assert.equal(page.items.length, 1)
assert.equal(page.pageCount, 2)

let rateLimited = false
const rateLimitedQueue = await runTmdbIdentityReviewQueueFromRecords(records, {
  throttleMs: 0,
  searchCandidates: async ({ query, mediaTypes }) => {
    if (query === 'Synthetic Series') {
      const error = new Error('synthetic rate limit')
      error.status = 429
      throw error
    }
    return searchCandidates({ query, mediaTypes })
  }
})
assert.equal(rateLimitedQueue.haltedReason.includes('rate-limited'), true)
assert.equal(rateLimitedQueue.pendingTitleIds.includes('title:series'), true)
assert.deepEqual(records, before)

const retriedQueue = await runTmdbIdentityReviewQueueFromRecords(records, {
  throttleMs: 0,
  eligibleTitleIds: rateLimitedQueue.pendingTitleIds,
  previousItems: rateLimitedQueue.items,
  searchCandidates
})
assert.equal(retriedQueue.pendingTitleIds.length, 0)
assert.equal(retriedQueue.items.length, 4)
assert.deepEqual(records, before)

const failedQueue = await runTmdbIdentityReviewQueueFromRecords(records, {
  throttleMs: 0,
  searchCandidates: async ({ query, mediaTypes }) => {
    if (query === 'Synthetic Missing') throw new Error('synthetic network failure')
    return searchCandidates({ query, mediaTypes })
  }
})
assert.equal(failedQueue.pendingTitleIds.length, 0)
assert.equal(failedQueue.items.find(item => item.titleId === 'title:missing').error.includes('unavailable'), true)
assert.deepEqual(records, before)

console.log('Identity review queue checks passed.')
