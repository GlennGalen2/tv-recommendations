import assert from 'node:assert/strict'
import {
  runTmdbMatchingEvaluationFromRecords,
  runTmdbMatchingPilotFromRecords,
  selectTmdbEvaluationTitles,
  selectTmdbPilotTitles
} from '../src/data/tmdbMatchingPilot.js'
import { normalizeAmazonLookupTitle } from '../src/data/amazonLookupTitle.js'

const normalizationExamples = [
  ['Synthetic Series - Season 2', 'Synthetic Series', 'series'],
  ['Synthetic Series, Season 3', 'Synthetic Series', 'series'],
  ['Synthetic Series Season 4', 'Synthetic Series', 'series'],
  ['Synthetic Series: Episode 6', 'Synthetic Series', 'series'],
  ['Synthetic Series - Episode 0: Official Trailer', 'Synthetic Series', 'series'],
  ['Synthetic Movie: Preview', 'Synthetic Movie', null]
]
for (const [sourceTitle, searchTitle, mediaTypeHint] of normalizationExamples) {
  const result = normalizeAmazonLookupTitle(sourceTitle)
  assert.equal(result.applied, true)
  assert.equal(result.searchTitle, searchTitle)
  assert.equal(result.mediaTypeHint, mediaTypeHint)
  assert.notEqual(result.transformation, 'none')
  assert.ok(result.reason)
}
for (const sourceTitle of ['Episode 0: Synthetic Trailer', 'Season 2 Official Trailer', 'A Preview of Everything']) {
  const result = normalizeAmazonLookupTitle(sourceTitle)
  assert.equal(result.applied, false)
  assert.equal(result.searchTitle, sourceTitle)
}

const sources = [
  { id: 'source:netflix', name: 'Netflix' },
  { id: 'source:amazon-prime-video', name: 'Amazon Prime Video' }
]
const titles = [
  ...[1, 2, 3].map(number => ({ id: `title:movie-${number}`, type: 'movie', title: `Synthetic Movie ${number}`, originalTitle: `Synthetic Movie ${number}` })),
  ...[1, 2, 3].map(number => ({ id: `title:series-${number}`, type: 'series', title: `Synthetic Series ${number}`, originalTitle: `Synthetic Series ${number}` })),
  ...[1, 2, 3].map(number => ({ id: `title:amazon-unknown-${number}`, type: 'unknown', title: `Synthetic Amazon TV ${number}`, originalTitle: `Synthetic Amazon TV ${number}` })),
  { id: 'title:ambiguous', type: 'unknown', title: 'Synthetic: Ambiguous Title', originalTitle: 'Synthetic: Ambiguous Title' }
]
const events = titles.map((title, index) => ({
  id: `evt-${index}`,
  titleId: title.id,
  eventType: 'playback',
  mediaScope: title.type === 'series' ? { level: 'episode', seasonNumber: 1, episodeNumber: index + 1 } : { level: 'title' },
  observations: { sourceTitle: title.id === 'title:series-1' ? 'Synthetic Series 1: Season 1: Episode 4' : title.originalTitle },
  provenance: { sourceId: title.id.includes('amazon') ? 'source:amazon-prime-video' : 'source:netflix' }
}))
const records = { titles, events, sources }
const before = structuredClone(records)

const selection = selectTmdbPilotTitles(records)
assert.equal(selection.length, 10)
assert.equal(selection.filter(record => record.title.type === 'movie').length, 3)
assert.equal(selection.filter(record => record.title.type === 'series').length, 3)
assert.equal(selection.filter(record => record.title.type === 'unknown' && record.sourceIds.includes('source:amazon-prime-video')).length, 3)
assert.equal(selection.some(record => record.ambiguous), true)

const searchQueries = []
const pilot = await runTmdbMatchingPilotFromRecords(records, {
  searchCandidates: async ({ query, mediaTypes }) => {
    searchQueries.push(query)
    return mediaTypes.map((mediaType, index) => ({
    provider: 'tmdb', externalId: `${query}-${index}`, mediaType,
    canonicalTitle: query, releaseDate: null, releaseYear: null,
    ...(mediaType === 'series' ? { seasonNumber: 1, episodeNumber: 4 } : {})
    }))
  }
})
assert.equal(pilot.results.length, 10)
assert.equal(pilot.results.some(result => result.alternateCandidates.length > 0), true)
assert.equal(pilot.distribution['strong-candidate'], 0)
assert.equal(searchQueries.includes('Synthetic Series 1'), true)
assert.equal(searchQueries.includes('Synthetic Series 1: Season 1: Episode 4'), false)
assert.deepEqual(records, before)

const evaluationTitles = Array.from({ length: 200 }, (_, index) => ({
  id: `title:evaluation-${index}`,
  type: index % 5 === 0 ? 'unknown' : index % 2 === 0 ? 'movie' : 'series',
  title: index % 7 === 0 ? `Name ${index}` : `Synthetic Evaluation ${index}`,
  originalTitle: index % 10 === 0 ? `Synthetic Evaluation ${index} - Season 2` : index % 5 === 0 ? `Synthetic: Ambiguous ${index}` : `Synthetic Evaluation ${index}`
}))
const evaluationEvents = evaluationTitles.flatMap((title, index) => [
  {
    id: `evaluation-event-${index}`,
    titleId: title.id,
    eventType: 'playback',
    mediaScope: title.type === 'series' ? { level: 'episode', seasonNumber: 1, episodeNumber: 1 } : { level: 'title' },
    observations: { sourceTitle: title.originalTitle },
    provenance: { sourceId: title.type === 'unknown' ? 'source:amazon-prime-video' : 'source:netflix' }
  },
  ...(index === 1 ? [{
    id: 'evaluation-cross-source', titleId: title.id, eventType: 'playback', mediaScope: { level: 'title' },
    observations: { sourceTitle: title.originalTitle }, provenance: { sourceId: 'source:amazon-prime-video' }
  }] : [])
])
const evaluationRecords = { titles: evaluationTitles, events: evaluationEvents, sources }
const evaluationBefore = structuredClone(evaluationRecords)
const evaluationSelection = selectTmdbEvaluationTitles(evaluationRecords)
assert.equal(evaluationSelection.length, 50)
assert.deepEqual(evaluationSelection.map(record => record.title.id), selectTmdbEvaluationTitles(evaluationRecords).map(record => record.title.id))
assert.equal(evaluationSelection.some(record => record.sourceIds.length > 1), true)
assert.equal(evaluationSelection.some(record => record.hasEpisodeStructure), true)
assert.equal(evaluationSelection.some(record => record.ambiguous), true)
const largeEvaluationSelection = selectTmdbEvaluationTitles(evaluationRecords, 200)
assert.equal(largeEvaluationSelection.length, 200)
assert.equal(largeEvaluationSelection.some(record => record.lookupNormalization.applied), true)
assert.equal(largeEvaluationSelection.some(record => record.sourceIds.length > 1), true)

const evaluation = await runTmdbMatchingEvaluationFromRecords(evaluationRecords, {
  limit: 50,
  searchCandidates: async ({ query, mediaTypes }) => [
    { provider: 'tmdb', externalId: `${query}-primary`, mediaType: mediaTypes[0], canonicalTitle: query, releaseDate: null, releaseYear: null },
    ...(query.endsWith('1') ? [{ provider: 'tmdb', externalId: `${query}-alternate`, mediaType: mediaTypes[0], canonicalTitle: query, releaseDate: null, releaseYear: null }] : [])
  ]
})
assert.equal(evaluation.results.length, 50)
assert.equal(evaluation.sameNameAmbiguityCases > 0, true)
assert.equal(evaluation.crossSourceTitles > 0, true)
assert.equal(evaluation.obviousFalsePositives, 0)
assert.equal(evaluation.confidenceDistribution.review75To84 > 0, true)
assert.equal(evaluation.normalization.normalizedLookups > 0, true)
assert.deepEqual(evaluationRecords, evaluationBefore)

const largeEvaluation = await runTmdbMatchingEvaluationFromRecords(evaluationRecords, {
  limit: 200,
  searchCandidates: async ({ query, mediaTypes }) => [{ provider: 'tmdb', externalId: `${query}-primary`, mediaType: mediaTypes[0], canonicalTitle: query, releaseDate: null, releaseYear: null }]
})
assert.equal(largeEvaluation.results.length, 200)
assert.equal(largeEvaluation.normalization.normalizedLookups > 0, true)
assert.deepEqual(evaluationRecords, evaluationBefore)

const typeConflictEvaluation = await runTmdbMatchingEvaluationFromRecords({
  titles: [{ id: 'title:conflict', type: 'movie', title: 'Synthetic Conflict', originalTitle: 'Synthetic Conflict' }],
  events: [{ id: 'event:conflict', titleId: 'title:conflict', eventType: 'playback', mediaScope: { level: 'title' }, observations: { sourceTitle: 'Synthetic Conflict' }, provenance: { sourceId: 'source:netflix' } }],
  sources
}, {
  limit: 1,
  selection: ({ titles: selectedTitles, events: selectedEvents, sources: selectedSources }) => selectTmdbEvaluationTitles({ titles: selectedTitles, events: selectedEvents, sources: selectedSources }, 1),
  searchCandidates: async () => [{ provider: 'tmdb', externalId: 'synthetic-conflict', mediaType: 'series', canonicalTitle: 'Synthetic Conflict', releaseDate: null, releaseYear: null }]
})
assert.equal(typeConflictEvaluation.typeConflicts, 1)

console.log('TMDb matching-pilot checks passed.')
