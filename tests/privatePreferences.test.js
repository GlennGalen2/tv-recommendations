import assert from 'node:assert/strict'
import { deriveBehavioralPreferenceEvidence, derivePrivatePreferenceAnalysis, previewExplicitPreferenceImport } from '../src/data/privatePreferences.js'

function event(id, viewerId, titleId, episodeNumber) {
  return { id, eventType: 'playback', viewerIds: [viewerId], titleId, mediaScope: { level: 'episode', seasonNumber: 1, episodeNumber } }
}
const events = [
  event('a1', 'viewer-1', 'title:complete', 1), event('a2', 'viewer-1', 'title:complete', 2), event('a3', 'viewer-1', 'title:complete', 3), event('a4', 'viewer-1', 'title:complete', 4),
  event('r1', 'viewer-1', 'title:repeat', 1), event('r2', 'viewer-1', 'title:repeat', 1),
  event('e1', 'viewer-2', 'title:early', 1), event('u1', 'viewer-2', 'title:uncertain', 1)
]
const availability = {
  'source:title:complete': { episodeCount: 4, continuedAvailabilityKnown: true, confidence: 0.9 },
  'source:title:repeat': { episodeCount: 4, continuedAvailabilityKnown: true, confidence: 0.9 },
  'source:title:early': { episodeCount: 8, continuedAvailabilityKnown: true, confidence: 0.9 },
  'source:title:uncertain': { episodeCount: 8, continuedAvailabilityKnown: false, confidence: 0.5 }
}
const behavioral = deriveBehavioralPreferenceEvidence({ events, availability })
assert.equal(behavioral.some(item => item.signal === 'completed_available_run' && item.viewerId === 'viewer-1'), true)
assert.equal(behavioral.some(item => item.signal === 'repeat_viewing'), true)
assert.equal(behavioral.some(item => item.signal === 'early_abandonment' && item.viewerId === 'viewer-2'), true)
assert.equal(behavioral.some(item => item.signal === 'availability_uncertain' && item.titleId === 'title:uncertain'), true)
assert.equal(behavioral.some(item => item.titleId === 'title:never-watched'), false)

const reactions = [
  { id: 'r1', viewerId: 'viewer-1', titleId: 'title:complete', reaction: 'loved', strength: 1, mechanisms: { positive: ['rootable-characters'], negative: [] }, supersedesReactionId: null },
  { id: 'r2-old', viewerId: 'viewer-2', titleId: 'title:complete', reaction: 'liked', mechanisms: { positive: [], negative: [] }, supersedesReactionId: null },
  { id: 'r2', viewerId: 'viewer-2', titleId: 'title:complete', reaction: 'disliked', strength: 0.8, mechanisms: { positive: [], negative: ['expository-dialogue'] }, supersedesReactionId: 'r2-old' },
  { id: 'r3', viewerId: 'viewer-1', titleId: 'title:repeat', reaction: 'disliked', strength: 1, mechanisms: { positive: [], negative: ['implausible-workplace-behavior'] }, supersedesReactionId: null }
]
const analysis = derivePrivatePreferenceAnalysis({ reactions, events, availability })
assert.equal(analysis.explicit.length, 3)
assert.equal(analysis.byViewer['viewer-1'].explicit, 2)
assert.equal(analysis.byViewer['viewer-2'].explicit, 1)
assert.equal(analysis.mechanisms.positive['rootable-characters'], 1)
assert.equal(analysis.mechanisms.negative['expository-dialogue'], 1)
assert.equal(analysis.differences.length, 1)
assert.equal(analysis.conflicts.some(item => item.titleId === 'title:repeat' && item.explicitOverride === 'disliked'), true)
assert.equal(JSON.stringify(analysis).includes('completed_available_run'), true)
assert.equal(JSON.stringify(analysis.explicit).includes('inferred-behavioral'), false)

const syntheticTitles = [
  { id: 'title:complete', title: 'Synthetic Complete', type: 'series', releaseYear: 2024, schemaVersion: 1, externalIds: { tmdb: '100' } },
  { id: 'title:movie', title: 'Synthetic Complete', type: 'movie', releaseYear: 2024, schemaVersion: 1, externalIds: { tmdb: '101' } },
  { id: 'title:same-2020', title: 'Synthetic Shared Name', type: 'movie', releaseYear: 2020, schemaVersion: 1, externalIds: { tmdb: '200' } },
  { id: 'title:same-2021', title: 'Synthetic Shared Name', type: 'movie', releaseYear: 2021, schemaVersion: 1, externalIds: { tmdb: '201' } },
  { id: 'title:source', title: 'Synthetic Source Label', type: 'unknown', schemaVersion: 1, externalIds: {} }
]
const syntheticResolutions = [{ id: 'resolution:synthetic', schemaVersion: 1, sourceTitleId: 'title:source', status: 'manually-confirmed', candidate: { provider: 'tmdb', externalId: '300', canonicalTitle: 'Synthetic Canonical Work', mediaType: 'tv', releaseYear: 2022 } }]
const importText = JSON.stringify({ format: 'tv-recommendations-explicit-preferences', formatVersion: 1, records: [
  { id: 'import-title-id', viewerId: 'viewer-1', titleId: 'title:complete', reaction: 'okay' },
  { id: 'import-type', viewerId: 'viewer-1', title: 'Synthetic Complete', mediaType: 'movie', reaction: 'liked', mechanisms: { positive: ['synthetic-mechanism'], negative: [] } },
  { id: 'import-year', viewerId: 'viewer-2', title: 'Synthetic Shared Name', year: 2021, reaction: 'loved' },
  { id: 'import-exact', viewerId: 'viewer-2', title: 'Synthetic Source Label', reaction: 'okay' },
  { id: 'import-tmdb', viewerId: 'viewer-1', title: 'Synthetic Alternate Label', tmdbId: '300', mediaType: 'tv', reaction: 'liked' },
  { id: 'import-ambiguous', viewerId: 'viewer-1', title: 'Synthetic Shared Name', reaction: 'liked' },
  { id: 'import-absent', viewerId: 'viewer-2', title: 'Synthetic Remembered Work', year: 2023, mediaType: 'tv', reaction: 'loved', note: 'Synthetic note' },
  { id: 'r1', viewerId: 'viewer-1', titleId: 'title:complete', reaction: 'loved' },
  { id: 'import-correction', viewerId: 'viewer-1', titleId: 'title:complete', reaction: 'disliked' }
] })
const preview = previewExplicitPreferenceImport(importText, { reactions, titles: syntheticTitles, resolutions: syntheticResolutions, viewerIds: new Set(['viewer-1', 'viewer-2']), fileName: 'synthetic-preferences.json' })
assert.equal(preview.summary.importable, 7)
assert.equal(preview.summary.duplicates, 1)
assert.equal(preview.summary.problems.length, 1)
assert.equal(preview.records.find(record => record.id === 'import-title-id').titleId, 'title:complete')
assert.equal(preview.records.find(record => record.id === 'import-type').titleId, 'title:movie')
assert.equal(preview.records.find(record => record.id === 'import-year').titleId, 'title:same-2021')
assert.equal(preview.records.find(record => record.id === 'import-exact').titleId, 'title:source')
assert.equal(preview.records.find(record => record.id === 'import-tmdb').titleId.startsWith('title:curated:'), true)
assert.equal(preview.records.find(record => record.id === 'import-absent').titleId.startsWith('title:curated:'), true)
assert.equal(preview.titles.length, 2)
assert.equal(preview.previewRecords.some(record => record.status === 'ambiguous'), true)
assert.equal(preview.records.find(record => record.id === 'import-type').provenance.importFileName, 'synthetic-preferences.json')
assert.equal(preview.records.find(record => record.id === 'import-correction').supersedesReactionId, 'import-title-id')
assert.equal(preview.records.find(record => record.id === 'import-year').viewerId, 'viewer-2')

console.log('Private preference checks passed.')
