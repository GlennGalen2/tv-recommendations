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

const importText = JSON.stringify({ format: 'tv-recommendations-explicit-preferences', formatVersion: 1, records: [
  { id: 'import-1', viewerId: 'viewer-1', titleId: 'title:new', reaction: 'liked', strength: 0.8, mechanisms: { positive: ['mystery'], negative: [] }, note: 'Synthetic note', provenance: { sourceRecordId: 'synthetic-1' } },
  { id: 'import-correction', viewerId: 'viewer-1', titleId: 'title:complete', reaction: 'okay', mechanisms: { positive: [], negative: [] } },
  { id: 'r1', viewerId: 'viewer-1', titleId: 'title:complete', reaction: 'loved' },
  { id: 'import-2', viewerId: 'viewer-2', titleId: 'title:missing', reaction: 'liked' }
] })
const preview = previewExplicitPreferenceImport(importText, { reactions, titleIds: new Set(['title:new', 'title:complete', 'title:repeat']), viewerIds: new Set(['viewer-1', 'viewer-2']), fileName: 'synthetic-preferences.json' })
assert.equal(preview.summary.importable, 2)
assert.equal(preview.summary.duplicates, 1)
assert.equal(preview.summary.problems.length, 1)
assert.equal(preview.records[0].supersedesReactionId, null)
assert.equal(preview.records[0].provenance.importFileName, 'synthetic-preferences.json')
assert.equal(preview.records.find(record => record.id === 'import-correction').supersedesReactionId, 'r1')

console.log('Private preference checks passed.')
