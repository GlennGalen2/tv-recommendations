import assert from 'node:assert/strict'
import { runTmdbMatchingPilotFromRecords, selectTmdbPilotTitles } from '../src/data/tmdbMatchingPilot.js'

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

console.log('TMDb matching-pilot checks passed.')
