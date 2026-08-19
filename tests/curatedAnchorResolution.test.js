import assert from 'node:assert/strict'
import { runCuratedAnchorResolutionFromRecords, selectCuratedPreferenceAnchors } from '../src/data/curatedAnchorResolution.js'

const titles = [
  { id: 'title:loved', title: 'Synthetic Loved Series', type: 'series', curatedReference: { kind: 'explicit-preference', title: 'Synthetic Loved Series', mediaType: 'tv' } },
  { id: 'title:joint', title: 'Synthetic Joint Movie', type: 'movie', curatedReference: { kind: 'explicit-preference', title: 'Synthetic Joint Movie', mediaType: 'movie' } },
  { id: 'title:liked', title: 'Synthetic Liked Work', type: 'unknown', curatedReference: { kind: 'explicit-preference', title: 'Synthetic Liked Work' } },
  { id: 'title:netflix-episode', title: 'Synthetic Parent: Season 2: Synthetic Child', originalTitle: 'Synthetic Parent: Season 2: Synthetic Child', type: 'series', provenance: { sourceId: 'source:netflix' } },
  { id: 'title:netflix-season', title: 'Synthetic Season Parent: Season 3', originalTitle: 'Synthetic Season Parent: Season 3', type: 'series', provenance: { sourceId: 'source:netflix' } },
  { id: 'title:amazon-season', title: 'Synthetic Amazon Parent - Season 3', originalTitle: 'Synthetic Amazon Parent - Season 3', type: 'unknown', provenance: { sourceId: 'source:amazon-prime-video' } },
  { id: 'title:not-curated', title: 'Synthetic Imported Work', type: 'movie' }
]
const reactions = [
  { id: 'reaction:loved', viewerId: 'viewer-1', titleId: 'title:loved', reaction: 'loved', strength: 1, mechanisms: { positive: ['synthetic-mechanism'], negative: [] } },
  { id: 'reaction:joint-one', viewerId: 'viewer-1', titleId: 'title:joint', reaction: 'liked', strength: 1, mechanisms: { positive: ['synthetic-joint'], negative: [] } },
  { id: 'reaction:joint-two', viewerId: 'viewer-2', titleId: 'title:joint', reaction: 'loved', strength: 1, mechanisms: { positive: ['synthetic-joint'], negative: [] } },
  { id: 'reaction:liked-old', viewerId: 'viewer-1', titleId: 'title:liked', reaction: 'okay', strength: 1, supersedesReactionId: null },
  { id: 'reaction:liked', viewerId: 'viewer-1', titleId: 'title:liked', reaction: 'liked', strength: 1, supersedesReactionId: 'reaction:liked-old' },
  { id: 'reaction:netflix', viewerId: 'viewer-1', titleId: 'title:netflix-episode', reaction: 'loved', strength: 1 },
  { id: 'reaction:netflix-season', viewerId: 'viewer-1', titleId: 'title:netflix-season', reaction: 'loved', strength: 1 },
  { id: 'reaction:amazon-season', viewerId: 'viewer-1', titleId: 'title:amazon-season', reaction: 'loved', strength: 1 }
]
const records = { titles, reactions, resolutions: [] }
const before = structuredClone(records)
const selected = selectCuratedPreferenceAnchors(records)
assert.equal(selected.length, 6)
assert.equal(selected[0].title.id, 'title:joint')
assert.equal(selected.some(record => record.title.id === 'title:not-curated'), false)

const result = await runCuratedAnchorResolutionFromRecords(records, {
  searchCandidates: async ({ query, mediaTypes }) => query === 'Synthetic Liked Work' ? [] : [{ provider: 'tmdb', externalId: `${query}-id`, mediaType: mediaTypes[0], canonicalTitle: query, releaseYear: 2024 }],
  onProgress: () => {}
})
assert.equal(result.selectedCount, 6)
assert.equal(result.eligibleCount, 6)
assert.equal(result.counts['needs-review'], 5)
assert.equal(result.counts.unresolved, 1)
assert.equal(result.counts.noCandidateCases, 1)
assert.equal(result.items.find(item => item.titleId === 'title:loved').bestCandidate.mediaType, 'series')
assert.equal(result.items.find(item => item.titleId === 'title:joint').bestCandidate.mediaType, 'movie')
assert.equal(result.items.find(item => item.titleId === 'title:netflix-episode').searchTitle, 'Synthetic Parent')
assert.equal(result.items.find(item => item.titleId === 'title:netflix-season').searchTitle, 'Synthetic Season Parent')
assert.equal(result.items.find(item => item.titleId === 'title:amazon-season').searchTitle, 'Synthetic Amazon Parent')
assert.deepEqual(records, before)

const confirmed = await runCuratedAnchorResolutionFromRecords({ ...records, resolutions: [{ id: 'resolution:synthetic', sourceTitleId: 'title:loved', status: 'manually-confirmed', candidate: { provider: 'tmdb', externalId: '1', mediaType: 'series', canonicalTitle: 'Synthetic Loved Series' } }] }, { searchCandidates: async () => { throw new Error('Confirmed anchors must not be searched.') } })
assert.equal(confirmed.eligibleCount, 5)
assert.equal(confirmed.items.find(item => item.titleId === 'title:loved').category, 'confirmed')

console.log('Curated anchor resolution checks passed.')
