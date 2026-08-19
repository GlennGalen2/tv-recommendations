import assert from 'node:assert/strict'
import { runTmdbDiscovery, runTmdbDiscoveryFromRecords, selectDiscoverySeeds } from '../src/data/tmdbDiscovery.js'

const titles = [
  { id: 'anchor:one', title: 'Synthetic Loved One', type: 'series' }, { id: 'anchor:two', title: 'Synthetic Loved Two', type: 'series' },
  { id: 'anchor:rejected', title: 'Synthetic Rejected', type: 'series' }, { id: 'watched', title: 'Synthetic Watched - Season 1', originalTitle: 'Synthetic Watched - Season 1', type: 'unknown', provenance: { sourceId: 'source:amazon-prime-video' } },
  { id: 'rated', title: 'Synthetic Rated', type: 'series' }
]
const reactions = [
  { id: 'r1', viewerId: 'viewer-1', titleId: 'anchor:one', reaction: 'loved', strength: 1, mechanisms: { positive: ['synthetic-a'], negative: [] } },
  { id: 'r2', viewerId: 'viewer-2', titleId: 'anchor:one', reaction: 'liked', strength: 1, mechanisms: { positive: ['synthetic-a'], negative: [] } },
  { id: 'r3', viewerId: 'viewer-1', titleId: 'anchor:two', reaction: 'liked', strength: 1, mechanisms: { positive: ['synthetic-b'], negative: [] } },
  { id: 'r4', viewerId: 'viewer-1', titleId: 'anchor:rejected', reaction: 'loved', strength: 1 },
  { id: 'r5', viewerId: 'viewer-2', titleId: 'rated', reaction: 'liked', strength: 1 }
]
const resolutions = [
  { id: 'one', sourceTitleId: 'anchor:one', status: 'manually-confirmed', candidate: { provider: 'tmdb', externalId: '1', mediaType: 'series', canonicalTitle: 'Synthetic Loved One' } },
  { id: 'two', sourceTitleId: 'anchor:two', status: 'manually-confirmed', candidate: { provider: 'tmdb', externalId: '2', mediaType: 'series', canonicalTitle: 'Synthetic Loved Two' } },
  { id: 'rejected', sourceTitleId: 'anchor:rejected', status: 'manually-rejected', candidate: { provider: 'tmdb', externalId: '3', mediaType: 'series', canonicalTitle: 'Synthetic Rejected' } }
]
const events = [{ id: 'watch', eventType: 'playback', viewerIds: ['viewer-1'], titleId: 'watched' }]
const records = { titles, reactions, resolutions, events }
const before = structuredClone(records)
assert.equal(selectDiscoverySeeds(records).length, 2)
const result = await runTmdbDiscoveryFromRecords(records, {
  fetchRecommendations: async ({ seed }) => [
    { provider: 'tmdb', externalId: '10', mediaType: 'tv', canonicalTitle: 'Synthetic Shared Candidate', releaseYear: 2024, overview: '', genreIds: [], genres: [], voteAverage: 7, voteCount: 10, popularity: 5, posterPath: null },
    { provider: 'tmdb', externalId: seed.externalId === '1' ? '11' : '12', mediaType: 'tv', canonicalTitle: seed.externalId === '1' ? 'Synthetic Watched' : 'Synthetic Rated', releaseYear: 2024, overview: '', genreIds: [], genres: [], voteAverage: 7, voteCount: 10, popularity: 5, posterPath: null }
  ],
  fetchDetails: async ({ candidate }) => ({ ...candidate, genres: [{ id: 1, name: 'Synthetic Genre' }] }),
  concurrency: 2
})
assert.equal(result.seeds.length, 2)
assert.equal(result.candidates.length, 3)
assert.equal(result.candidates.find(candidate => candidate.externalId === '10').discoverySeeds.length, 2)
assert.equal(result.viewerOne.some(candidate => candidate.canonicalTitle === 'Synthetic Watched'), false)
assert.equal(result.viewerTwo.some(candidate => candidate.canonicalTitle === 'Synthetic Rated'), false)
assert.equal(result.viewerOne.some(candidate => candidate.canonicalTitle === 'Synthetic Rated'), true)
assert.equal(result.joint.some(candidate => candidate.canonicalTitle === 'Synthetic Watched' || candidate.canonicalTitle === 'Synthetic Rated'), false)
assert.equal(result.candidates.find(candidate => candidate.externalId === '10').genres[0].name, 'Synthetic Genre')
assert.deepEqual(records, before)

const capped = await runTmdbDiscoveryFromRecords(records, {
  fetchRecommendations: async ({ seed }) => Array.from({ length: 8 }, (_, index) => ({ provider: 'tmdb', externalId: `${seed.externalId}-${index}`, mediaType: 'tv', canonicalTitle: `Synthetic Candidate ${seed.externalId}-${index}`, releaseYear: 2024, overview: null, genreIds: [], genres: [], voteAverage: null, voteCount: null, popularity: null, posterPath: null })),
  fetchDetails: async ({ candidate }) => candidate,
  candidateLimit: 1
})
assert.equal(capped.candidates.length, 1)

const partial = await runTmdbDiscoveryFromRecords(records, {
  fetchRecommendations: async ({ seed }) => {
    if (seed.externalId === '2') throw new Error('synthetic network failure')
    return [{ provider: 'tmdb', externalId: 'partial', mediaType: 'tv', canonicalTitle: 'Synthetic Partial', releaseYear: 2024, overview: null, genreIds: [], genres: [], voteAverage: null, voteCount: null, popularity: null, posterPath: null }]
  },
  fetchDetails: async ({ candidate }) => candidate
})
assert.equal(partial.candidates.length, 1)
assert.equal(partial.errors.length, 1)

const enriched = await runTmdbDiscoveryFromRecords({ ...records, candidateEvidence: [
  { id: 'evidence-positive', target: { provider: 'tmdb', externalId: 'quality-positive', mediaType: 'tv' }, attributes: [{ attribute: 'synthetic-a', direction: 'present', value: 1, confidence: 1, mechanisms: ['synthetic-a'], source: 'synthetic-human-curation', rationale: 'Synthetic positive candidate evidence.' }] },
  { id: 'evidence-negative', target: { provider: 'tmdb', externalId: 'quality-negative', mediaType: 'tv' }, attributes: [{ attribute: 'synthetic-a', direction: 'absent', value: 1, confidence: 1, mechanisms: ['synthetic-a'], source: 'synthetic-human-curation', rationale: 'Synthetic negative candidate evidence.' }] }
] }, {
  fetchRecommendations: async () => [
    { provider: 'tmdb', externalId: 'quality-positive', mediaType: 'tv', canonicalTitle: 'Synthetic Quality Positive', releaseYear: 2024, overview: null, genreIds: [], genres: [], voteAverage: null, voteCount: null, popularity: null, posterPath: null },
    { provider: 'tmdb', externalId: 'quality-negative', mediaType: 'tv', canonicalTitle: 'Synthetic Quality Negative', releaseYear: 2024, overview: null, genreIds: [], genres: [], voteAverage: null, voteCount: null, popularity: null, posterPath: null }
  ],
  fetchDetails: async ({ candidate }) => candidate
})
const enrichmentScore = (externalId, viewerId) => enriched.candidates.find(candidate => candidate.externalId === externalId).viewerScores.find(score => score.viewerId === viewerId).score
assert.equal(enrichmentScore('quality-positive', 'viewer-1') > enrichmentScore('quality-negative', 'viewer-1'), true)

const wrapperEvidence = [{ id: 'wrapper-evidence', target: { provider: 'tmdb', externalId: 'wrapper-candidate', mediaType: 'tv' }, attributes: [{ attribute: 'synthetic-a', direction: 'present', value: 1, confidence: 1, mechanisms: ['synthetic-a'], source: 'synthetic-human-curation', rationale: 'Synthetic wrapper-path evidence.' }] }]
const wrapperResult = await runTmdbDiscovery({
  listRecords: async storeName => ({ titles, events, reactions, candidateEvidence: wrapperEvidence }[storeName] || []),
  getIdentityReview: async () => ({ resolutions }),
  fetchRecommendations: async () => [{ provider: 'tmdb', externalId: 'wrapper-candidate', mediaType: 'tv', canonicalTitle: 'Synthetic Wrapper Candidate', releaseYear: 2024, overview: null, genreIds: [], genres: [], voteAverage: null, voteCount: null, popularity: null, posterPath: null }],
  fetchDetails: async ({ candidate }) => candidate
})
assert.equal(wrapperResult.candidates[0].viewerScores.find(score => score.viewerId === 'viewer-1').candidateEvidenceId, 'wrapper-evidence')

const rateLimited = await runTmdbDiscoveryFromRecords(records, { fetchRecommendations: async () => { const error = new Error('synthetic'); error.status = 429; throw error }, fetchDetails: async () => ({}) })
assert.equal(rateLimited.halted, true)
assert.equal(rateLimited.errors[0].status, 429)
console.log('TMDb discovery checks passed.')
