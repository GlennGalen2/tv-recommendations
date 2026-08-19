import assert from 'node:assert/strict'
import {
  buildAmazonPrimeImportPreview,
  parseAmazonPrimeViewingHistoryCsv
} from '../src/importers/amazonPrimeViewingHistory.js'

const syntheticCsv = `Title,Watch Date,Series Title,Season Number,Episode Name,Episode Number,Content Type,ASIN,Device Type
Synthetic Film,8/01/2026,,,,,Movie,amz-film-1,Web
Pilot,8/02/2026,Harbor Files,1,Pilot,1,Episode,amz-episode-1,TV
Finale,2026-08-03 21:30:00,Harbor Files,1,Finale,8,Episode,amz-episode-8,TV
Behind the Scenes,8/04/2026,Harbor Files,Specials,, ,Special,amz-special-1,TV
"A Movie: With a Colon",8/05/2026,,,,,,,Web
Repeated Same Day,8/06/2026,,,,,,,Web
Repeated Same Day,8/06/2026,,,,,,,Web
,8/07/2026,,,,,,,Web
Missing Date,,,,,,,,Web`

const parsed = await parseAmazonPrimeViewingHistoryCsv(syntheticCsv, {
  viewerId: 'viewer-1',
  fileName: 'synthetic-amazon-viewing-history.csv'
})

assert.equal(parsed.summary.totalRows, 9)
assert.equal(parsed.summary.recognizedRows, 7)
assert.equal(parsed.summary.rejectedRows, 2)
assert.equal(parsed.summary.likelyMovies, 3)
assert.equal(parsed.summary.unresolvedTv, 0)
assert.equal(parsed.summary.episodes, 2)
assert.equal(parsed.summary.specials, 1)
assert.equal(parsed.summary.ambiguous, 1)
assert.equal(parsed.summary.unrecognizedHeaderCount, 1)
assert.deepEqual(parsed.summary.recognizedFields, [
  'title', 'date', 'series', 'season', 'episode', 'episodeNumber', 'contentType', 'contentId'
])
assert.deepEqual(parsed.summary.problemCounts, {
  'ambiguous-title': 1,
  'missing-title': 1,
  'invalid-date': 1
})

const episode = parsed.events.find(event => event.observations.sourceTitle === 'Pilot')
assert.equal(episode.titleId.includes('harbor-files'), true)
assert.deepEqual(episode.mediaScope, {
  level: 'episode',
  seasonNumber: 1,
  episodeNumber: 1,
  episodeTitle: 'Pilot'
})
assert.equal(episode.observations.sourceContentId, 'amz-episode-1')
assert.equal(episode.observations.datePrecision, 'date')
assert.equal(episode.occurredAt, null)

const datetimeEpisode = parsed.events.find(event => event.observations.sourceTitle === 'Finale')
assert.notEqual(datetimeEpisode.occurredAt, null)
assert.equal(datetimeEpisode.observations.datePrecision, 'date-time')

const repeats = parsed.events.filter(event => event.observations.sourceTitle === 'Repeated Same Day')
assert.equal(repeats.length, 2)
assert.notEqual(repeats[0].id, repeats[1].id)

const preview = buildAmazonPrimeImportPreview(parsed, {
  eventIds: new Set([parsed.events[0].id]),
  batchIds: new Set()
})
assert.equal(preview.preview.duplicateEvents, 1)
assert.equal(preview.preview.newEvents, 6)

const repeatedPreview = buildAmazonPrimeImportPreview(parsed, {
  eventIds: new Set(),
  batchIds: new Set([parsed.batch.id])
})
assert.equal(repeatedPreview.preview.batchAlreadyImported, true)
assert.equal(repeatedPreview.preview.newEvents, 0)

const alternateHeaders = `Video Title,Date Watched,Show,Season,Episode #,Type
Episode One,8/08/2026,Alternate Show,2,4,Episode`
const alternate = await parseAmazonPrimeViewingHistoryCsv(alternateHeaders, { viewerId: 'viewer-2' })
assert.equal(alternate.summary.recognizedRows, 1)
assert.equal(alternate.summary.episodes, 1)

const contentCategoryOnly = `Title,Date,Content Type
Untitled TV Playback,8/09/2026,TV Show
Explicit Title: Season 1: Pilot,8/10/2026,TV Show
Category Movie,8/11/2026,Movie`
const categoryOnly = await parseAmazonPrimeViewingHistoryCsv(contentCategoryOnly, { viewerId: 'viewer-1' })
assert.equal(categoryOnly.summary.unresolvedTv, 1)
assert.equal(categoryOnly.summary.episodes, 1)
assert.equal(categoryOnly.summary.likelyMovies, 1)
const unresolvedTvEvent = categoryOnly.events.find(event => event.observations.sourceTitle === 'Untitled TV Playback')
assert.equal(unresolvedTvEvent.mediaScope.level, 'title')
assert.equal(unresolvedTvEvent.observations.sourceContentType, 'TV Show')
assert.equal(categoryOnly.titles.find(title => title.id === unresolvedTvEvent.titleId).type, 'unknown')

await assert.rejects(
  parseAmazonPrimeViewingHistoryCsv('Title,Device\nSynthetic,Web', { viewerId: 'viewer-1' }),
  /recognizable title and watch-date/
)

console.log('Amazon Prime viewing-history parser checks passed.')
