import assert from 'node:assert/strict'
import { discoveryResearchPriority, LONG_TAIL_DISCOVERY_COHORTS, resolveTmdbPreferredServices, runTmdbDiscovery, runTmdbDiscoveryFromRecords, runTmdbPreferredServiceDiscovery, runTmdbQualityCohortDiscovery, selectDiscoverySeeds } from '../src/data/tmdbDiscovery.js'
import { fetchTmdbCohortDiscovery } from '../src/data/tmdbDiscoveryClient.js'

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
const tracedCandidate = result.candidates.find(candidate => candidate.externalId === '10')
for (const viewerScore of tracedCandidate.viewerScores) {
  assert.equal(viewerScore.trace.finalScore, viewerScore.score)
  assert.equal(viewerScore.trace.engineScore + viewerScore.trace.discoveryContribution, viewerScore.score)
}
assert.equal(tracedCandidate.joint.trace.finalScore, tracedCandidate.joint.value)
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

const resolvedProviders = await resolveTmdbPreferredServices({ region: 'us', serviceNames: ['Synthetic Plus', 'Not Available'], priorityServiceNames: ['Synthetic Plus'] }, {
  fetchProviders: async ({ mediaType }) => mediaType === 'tv'
    ? [{ id: '7', name: 'Synthetic Plus' }]
    : [{ id: '8', name: 'Synthetic Cinema' }]
})
assert.equal(resolvedProviders.region, 'US')
assert.deepEqual(resolvedProviders.selectedProviders, [{ id: '7', name: 'Synthetic Plus', mediaType: 'tv' }])
assert.deepEqual(resolvedProviders.selectedPriorityProviders, [{ id: '7', name: 'Synthetic Plus', mediaType: 'tv' }])
assert.deepEqual(resolvedProviders.unmatchedServiceNames, ['Not Available'])

const providerCalls = []
const preferred = await runTmdbPreferredServiceDiscovery(records, { region: 'US', serviceNames: ['Synthetic Plus'] }, {
  fetchProviders: async ({ mediaType }) => mediaType === 'tv' ? [{ id: '7', name: 'Synthetic Plus' }] : [],
  fetchProviderDiscovery: async input => {
    providerCalls.push(input)
    return [{ provider: 'tmdb', externalId: 'service-only', mediaType: 'tv', canonicalTitle: 'Synthetic Service Candidate', releaseYear: 2024, overview: null, genreIds: [], genres: [], voteAverage: null, voteCount: null, popularity: null, posterPath: null }]
  },
  fetchRecommendations: async () => [], fetchDetails: async ({ candidate }) => candidate
})
assert.equal(providerCalls.length, 1)
assert.deepEqual(providerCalls[0], { mediaType: 'tv', providerIds: ['7'], region: 'US', page: 1 })
assert.equal(preferred.candidates[0].discoverySources[0].providerName, 'Synthetic Plus')
assert.match(preferred.availability.attribution, /JustWatch/)
assert.equal(preferred.persisted, false)

const providerOnly = await runTmdbPreferredServiceDiscovery(records, { region: 'US', serviceNames: ['Synthetic Plus'] }, {
  providerOnly: true,
  fetchProviders: async ({ mediaType }) => mediaType === 'tv' ? [{ id: '7', name: 'Synthetic Plus' }] : [],
  fetchRecommendations: async () => { throw new Error('Anchor recommendations must not run in provider-only mode.') },
  fetchProviderDiscovery: async () => [{ provider: 'tmdb', externalId: 'provider-only', mediaType: 'tv', canonicalTitle: 'Synthetic Provider Only', releaseYear: 2024, overview: null, genreIds: [], genres: [], voteAverage: null, voteCount: null, popularity: null, posterPath: null }],
  fetchDetails: async ({ candidate }) => candidate
})
assert.equal(providerOnly.seeds.length, 0)
assert.equal(providerOnly.candidates[0].discoverySources[0].providerName, 'Synthetic Plus')

let cohortUrl = null
const normalizedCohortCandidates = await fetchTmdbCohortDiscovery({
  cohort: { id: 'synthetic-cohort', mediaType: 'tv', filters: { with_genres: '18,80', 'vote_count.gte': '20', sort_by: 'vote_average.desc', unsupported_filter: 'ignored' } },
  providerIds: ['7', '8'], region: 'US', getToken: async () => 'synthetic-token',
  fetchImpl: async url => {
    cohortUrl = new URL(url)
    return { ok: true, json: async () => ({ results: [{ id: 901, name: 'Synthetic Cohort Result', first_air_date: '2024-01-01', genre_ids: [18, 80], vote_average: 8, vote_count: 100 }] }) }
  }
})
assert.equal(normalizedCohortCandidates[0].canonicalTitle, 'Synthetic Cohort Result')
assert.equal(cohortUrl.pathname, '/3/discover/tv')
assert.equal(cohortUrl.searchParams.get('with_watch_providers'), '7|8')
assert.equal(cohortUrl.searchParams.get('with_genres'), '18,80')
assert.equal(cohortUrl.searchParams.get('unsupported_filter'), null)
assert.equal(LONG_TAIL_DISCOVERY_COHORTS.every(cohort => Number(cohort.filters['vote_count.lte']) > Number(cohort.filters['vote_count.gte'])), true)
assert.equal(LONG_TAIL_DISCOVERY_COHORTS.every(cohort => cohort.band === 'lower-exposure'), true)

const cohortCalls = []
const cohortRecords = structuredClone(records)
const qualityPilot = await runTmdbQualityCohortDiscovery(cohortRecords, { region: 'US', serviceNames: ['Synthetic Plus'] }, {
  cohorts: [
    { id: 'synthetic-crime', name: 'Synthetic crime', mediaType: 'tv', filters: { with_genres: '18,80' } },
    { id: 'synthetic-mystery', name: 'Synthetic mystery', mediaType: 'tv', filters: { with_genres: '18,9648' } }
  ],
  fetchProviders: async ({ mediaType }) => mediaType === 'tv' ? [{ id: '7', name: 'Synthetic Plus' }] : [],
  fetchCohortDiscovery: async input => {
    cohortCalls.push(input)
    return [
      { provider: 'tmdb', externalId: 'cohort-shared', mediaType: 'tv', canonicalTitle: 'Synthetic Shared Cohort Candidate', releaseYear: 2024, overview: null, genreIds: [], genres: [], voteAverage: 8, voteCount: 100, popularity: 5, posterPath: null },
      { provider: 'tmdb', externalId: `cohort-${input.cohort.id}`, mediaType: 'tv', canonicalTitle: `Candidate from ${input.cohort.name}`, releaseYear: 2024, overview: null, genreIds: [], genres: [], voteAverage: 7, voteCount: 50, popularity: 2, posterPath: null }
    ]
  },
  fetchRecommendations: async () => { throw new Error('Quality-cohort discovery must not use anchors.') },
  fetchDetails: async ({ candidate }) => candidate,
  candidateLimit: 10
})
assert.equal(cohortCalls.length, 2)
assert.equal(qualityPilot.seeds.length, 0)
assert.equal(qualityPilot.candidates.length, 3)
assert.equal(qualityPilot.qualityPilot.sourceCandidates, 4)
assert.equal(qualityPilot.qualityPilot.multiCohortCandidates, 1)
assert.equal(qualityPilot.candidates.find(candidate => candidate.externalId === 'cohort-shared').discoverySources.length, 2)
assert.equal(qualityPilot.candidates[0].externalId, 'cohort-shared')

const longTailPages = []
await runTmdbQualityCohortDiscovery(cohortRecords, { region: 'US', serviceNames: ['Synthetic Plus'] }, {
  cohorts: [LONG_TAIL_DISCOVERY_COHORTS[0]],
  fetchProviders: async () => [{ id: 7, name: 'Synthetic Plus', mediaType: 'tv' }],
  fetchCohortDiscovery: async input => { longTailPages.push(input.page); return [] },
  fetchRecommendations: async () => [], fetchDetails: async candidate => candidate
})
assert.deepEqual(longTailPages, [1, 2])
assert.equal(discoveryResearchPriority({ voteAverage: 9.5, voteCount: 20, discoverySources: [] }).value < discoveryResearchPriority({ voteAverage: 8.2, voteCount: 2000, discoverySources: [] }).value, true)
assert.deepEqual(cohortRecords, records)

const balanced = await runTmdbDiscoveryFromRecords(records, {
  fetchRecommendations: async () => Array.from({ length: 6 }, (_, index) => ({ provider: 'tmdb', externalId: `seed-${index}`, mediaType: 'tv', canonicalTitle: `Synthetic Seed Candidate ${index}`, releaseYear: 2024, overview: null, genreIds: [], genres: [], voteAverage: null, voteCount: null, popularity: 100 - index, posterPath: null })),
  fetchDetails: async ({ candidate }) => candidate,
  candidateLimit: 4,
  providerCandidates: [{ source: { kind: 'tmdb-watch-provider', providerId: '7', providerName: 'Synthetic Plus', mediaType: 'tv', region: 'US' }, candidates: Array.from({ length: 4 }, (_, index) => ({ provider: 'tmdb', externalId: `service-${index}`, mediaType: 'tv', canonicalTitle: `Synthetic Service Candidate ${index}`, releaseYear: 2024, overview: null, genreIds: [], genres: [], voteAverage: null, voteCount: null, popularity: 10 - index, posterPath: null })) }]
})
assert.equal(balanced.candidates.filter(candidate => candidate.discoverySources?.length).length, 2)
console.log('TMDb discovery checks passed.')
