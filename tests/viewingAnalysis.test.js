import assert from 'node:assert/strict'
import { deriveViewingAnalysis } from '../src/data/viewingAnalysis.js'

const sources = [
  { id: 'source:netflix', name: 'Netflix' },
  { id: 'source:amazon-prime-video', name: 'Amazon Prime Video' }
]

const titles = [
  { id: 'title:netflix:orbit', type: 'series', title: 'Orbit Station' },
  { id: 'title:amazon:orbit', type: 'series', title: 'Orbit Station' },
  { id: 'title:netflix:film', type: 'movie', title: 'Synthetic Film' },
  { id: 'title:netflix:unknown', type: 'unknown', title: 'Unresolved Playback' },
  { id: 'title:amazon:unknown', type: 'unknown', title: 'Unresolved Playback' }
]

function playback(id, titleId, sourceId, occurredOn, mediaScope = { level: 'title' }) {
  return {
    id,
    titleId,
    eventType: 'playback',
    occurredOn,
    mediaScope,
    observations: { sourceTitle: `${titleId} source title` },
    provenance: { sourceId }
  }
}

const analysis = deriveViewingAnalysis({
  sources,
  titles,
  events: [
    playback('evt-n1', 'title:netflix:orbit', 'source:netflix', '2024-01-01', { level: 'episode', seasonNumber: 1, episodeNumber: 1 }),
    playback('evt-n2', 'title:netflix:orbit', 'source:netflix', '2024-01-02', { level: 'episode', seasonNumber: 1, episodeNumber: 2 }),
    playback('evt-n1-repeat', 'title:netflix:orbit', 'source:netflix', '2024-01-03', { level: 'episode', seasonNumber: 1, episodeNumber: 1 }),
    playback('evt-a3', 'title:amazon:orbit', 'source:amazon-prime-video', '2024-01-04', { level: 'episode', seasonNumber: 1, episodeNumber: 3 }),
    playback('evt-film-1', 'title:netflix:film', 'source:netflix', '2024-02-01'),
    playback('evt-film-2', 'title:netflix:film', 'source:netflix', '2024-02-02'),
    playback('evt-unknown-netflix', 'title:netflix:unknown', 'source:netflix', '2024-03-01'),
    playback('evt-unknown-amazon', 'title:amazon:unknown', 'source:amazon-prime-video', '2024-03-02'),
    { id: 'evt-completed-demo', titleId: 'title:netflix:film', eventType: 'completed', occurredOn: '2024-04-01', provenance: { sourceId: 'source:netflix' } }
  ]
})

assert.equal(analysis.totals.playbackEvents, 8)
assert.equal(analysis.totals.distinctNormalizedTitles, 4)
assert.deepEqual(analysis.totals.sourceEventCounts, { Netflix: 6, 'Amazon Prime Video': 2 })
assert.equal(analysis.totals.knownSeries, 1)
assert.equal(analysis.totals.knownMovies, 1)
assert.equal(analysis.totals.unresolvedTitles, 2)
assert.deepEqual(analysis.totals.dateRange, { earliest: '2024-01-01', latest: '2024-03-02' })

const orbit = analysis.summaries.find(summary => summary.canonicalTitle === 'Orbit Station')
assert.equal(orbit.playbackEventCount, 4)
assert.equal(orbit.distinctEpisodeCount, 3)
assert.deepEqual(orbit.seasonsRepresented, [1])
assert.equal(orbit.repeatPlaybackDetected, true)
assert.deepEqual(orbit.services, ['Amazon Prime Video', 'Netflix'])
assert.equal(analysis.multiSourceTitles.length, 1)

const film = analysis.summaries.find(summary => summary.canonicalTitle === 'Synthetic Film')
assert.equal(film.repeatPlaybackDetected, true)
assert.equal(film.repeatPlaybackCount, 1)

assert.equal(analysis.unresolvedReferences.length, 2)
assert.notEqual(analysis.unresolvedReferences[0].id, analysis.unresolvedReferences[1].id)
assert.equal(JSON.stringify(analysis).includes('liked'), false)
assert.equal(JSON.stringify(analysis).includes('reaction'), false)

console.log('Viewing analysis checks passed.')
