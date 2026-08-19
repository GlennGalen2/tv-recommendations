import assert from 'node:assert/strict'
import {
  buildNetflixImportPreview,
  parseNetflixViewingHistoryCsv
} from '../src/importers/netflixViewingHistory.js'

const syntheticCsv = `Title,Date,Rating
"Orbit Station: Season 1: Episode 2",8/14/2026,
"Orbit Station: Season 1: Episode 2",8/14/2026,5
"Winter Archive: Season 2",2026-08-15 21:30:00,3
Synthetic Film,8/16/2026,2
"Ambiguous: Subtitle",8/17/2026,
Broken Date,not-a-date,4`

const parsed = await parseNetflixViewingHistoryCsv(syntheticCsv, {
  viewerId: 'viewer-1',
  fileName: 'synthetic-netflix-history.csv'
})

assert.equal(parsed.summary.totalRows, 6)
assert.equal(parsed.summary.recognizedRows, 5)
assert.equal(parsed.summary.episodes, 2)
assert.equal(parsed.summary.seasons, 1)
assert.equal(parsed.summary.series, 0)
assert.equal(parsed.summary.specials, 0)
assert.equal(parsed.summary.likelyMovies, 1)
assert.equal(parsed.summary.ambiguous, 1)
assert.equal(parsed.events[0].eventType, 'playback')
assert.deepEqual(parsed.events[0].mediaScope, {
  level: 'episode',
  seasonNumber: 1,
  episodeNumber: 2
})
assert.equal(parsed.events[0].provenance.importBatchId, null)
assert.equal(parsed.summary.problems.length, 2)

const repeatedDateOnlyEvents = parsed.events.filter(event =>
  event.observations.sourceTitle === 'Orbit Station: Season 1: Episode 2'
)
assert.equal(repeatedDateOnlyEvents.length, 2)
assert.notEqual(repeatedDateOnlyEvents[0].id, repeatedDateOnlyEvents[1].id)
assert.equal(repeatedDateOnlyEvents[0].occurredAt, null)
assert.equal(repeatedDateOnlyEvents[0].occurredOn, '2026-08-14')
assert.equal(repeatedDateOnlyEvents[0].observations.datePrecision, 'date')
assert.equal(repeatedDateOnlyEvents[0].observations.netflixRating, null)
assert.equal(repeatedDateOnlyEvents[1].observations.netflixRating, 5)
assert.equal(repeatedDateOnlyEvents[1].observations.netflixRatingRaw, '5')

const movieEvent = parsed.events.find(event => event.observations.sourceTitle === 'Synthetic Film')
assert.equal(movieEvent.observations.netflixRating, 2)
assert.equal('reaction' in movieEvent, false)
const datedTimeEvent = parsed.events.find(event => event.observations.sourceTitle === 'Winter Archive: Season 2')
assert.notEqual(datedTimeEvent.occurredAt, null)
assert.equal(datedTimeEvent.occurredOn, '2026-08-15')
assert.equal(datedTimeEvent.observations.datePrecision, 'date-time')
assert.deepEqual(parsed.summary.dateRange, { earliest: '2026-08-14', latest: '2026-08-17' })
assert.equal(parsed.summary.rejectedRows, 1)
assert.equal(parsed.summary.blankRowsExcluded, 0)

const preview = buildNetflixImportPreview(parsed, {
  eventIds: new Set([parsed.events[0].id]),
  batchIds: new Set()
})

assert.equal(preview.preview.duplicateEvents, 1)
assert.equal(preview.preview.newEvents, 4)
assert.equal(preview.newEvents.length, 4)

const repeatedPreview = buildNetflixImportPreview(parsed, {
  eventIds: new Set(),
  batchIds: new Set([parsed.batch.id])
})

assert.equal(repeatedPreview.preview.batchAlreadyImported, true)
assert.equal(repeatedPreview.preview.newEvents, 0)

const classificationCsv = `Title,Date
"Harbor: City of Glass: Season 2: The Last Door",8/18/2026
"Harbor: City of Glass: Season 2: Episode 3: The Last Door",8/18/2026
"North Star: Limited Series: The Birds: Part Two",8/18/2026
"The Archive: Series 3: Chapter 4: A Name: With Colons",8/18/2026
"The Archive: Season 4",8/18/2026
"The Orchard: Limited Series",8/18/2026
"The Archive: Specials: Reunion: After Hours",8/18/2026
"The Archive: Season 0: Recap",8/18/2026
"A Movie: With a Colon",8/18/2026
Standalone Movie,8/18/2026

,8/18/2026
Missing Date,`

const classified = await parseNetflixViewingHistoryCsv(classificationCsv, {
  viewerId: 'viewer-1',
  fileName: 'synthetic-netflix-naming-patterns.csv'
})

assert.equal(classified.summary.recognizedRows, 10)
assert.equal(classified.summary.episodes, 4)
assert.equal(classified.summary.seasons, 1)
assert.equal(classified.summary.series, 1)
assert.equal(classified.summary.specials, 2)
assert.equal(classified.summary.likelyMovies, 1)
assert.equal(classified.summary.ambiguous, 1)
assert.equal(classified.summary.blankRowsExcluded, 1)
assert.equal(classified.summary.rejectedRows, 2)
assert.deepEqual(classified.summary.problemCounts, {
  'ambiguous-title': 1,
  'missing-title': 1,
  'invalid-date': 1
})

const colonEpisode = classified.events.find(event =>
  event.observations.sourceTitle === 'Harbor: City of Glass: Season 2: The Last Door'
)
assert.deepEqual(colonEpisode.mediaScope, {
  level: 'episode',
  seasonNumber: 2,
  episodeTitle: 'The Last Door'
})
assert.equal(colonEpisode.titleId.includes('harbor-city-of-glass'), true)

console.log('Netflix viewing-history parser checks passed.')
