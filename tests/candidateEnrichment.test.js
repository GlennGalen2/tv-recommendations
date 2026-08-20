import assert from 'node:assert/strict'
import { previewCandidateEvidenceImport } from '../src/data/candidateEnrichment.js'
import { jointScore, learnMechanismWeights, scoreRecommendationCandidate, traceRecommendationCandidate } from '../src/data/recommendationEngine.js'

const importText = JSON.stringify({ format: 'tv-recommendations-candidate-enrichment', formatVersion: 1, records: [
  { id: 'evidence-fit', tmdbId: '101', mediaType: 'tv', attributes: [{ attribute: 'credible-professional-behavior', direction: 'present', value: 0.9, confidence: 0.9, mechanisms: ['credible-professional-behavior'], source: 'synthetic-human-curation', rationale: 'Synthetic reviewer evidence identifies credible professional behavior.' }] },
  { id: 'evidence-risk', tmdbId: '102', mediaType: 'tv', attributes: [{ attribute: 'criminal-protagonist-risk', direction: 'present', value: 0.9, confidence: 0.9, mechanisms: ['unrootable-protagonist', 'moral-identification'], source: 'synthetic-human-curation', rationale: 'Synthetic reviewer evidence identifies sustained criminal-protagonist risk.' }] },
  { id: 'invalid', tmdbId: '103', mediaType: 'tv', attributes: [{ attribute: 'invalid', direction: 'maybe', value: 2, confidence: 1, mechanisms: [], rationale: '' }] }
] })
const preview = previewCandidateEvidenceImport(importText, { fileName: 'synthetic-candidate-evidence.json' })
assert.equal(preview.summary.importable, 2)
assert.equal(preview.summary.problems.length, 1)
assert.equal(preview.records[0].provenance.importFileName, 'synthetic-candidate-evidence.json')
const correction = previewCandidateEvidenceImport(JSON.stringify({ format: 'tv-recommendations-candidate-enrichment', formatVersion: 1, records: [{ tmdbId: '101', mediaType: 'tv', attributes: [{ attribute: 'credible-professional-behavior', direction: 'present', value: 0.8, confidence: 0.8, mechanisms: ['credible-professional-behavior'], source: 'synthetic-human-curation', rationale: 'Synthetic correction.' }] }] }), { evidence: preview.records })
assert.equal(correction.records[0].supersedesEvidenceId, 'evidence-fit')

const titles = [
  { id: 'candidate:fit', title: 'Synthetic Fit', type: 'series', externalIds: { tmdb: '101' } },
  { id: 'candidate:risk', title: 'Synthetic Risk', type: 'series', externalIds: { tmdb: '102' } },
  { id: 'candidate:missing', title: 'Synthetic Missing', type: 'series', externalIds: { tmdb: '103' } },
  { id: 'candidate:unmatched', title: 'Synthetic Unmatched', type: 'series', externalIds: { tmdb: '104' } }
]
const reactions = [
  { id: 'anchor-positive', viewerId: 'viewer-1', titleId: 'anchor:positive', reaction: 'loved', strength: 1, mechanisms: { positive: ['credible-professional-behavior'], negative: [] } },
  { id: 'anchor-negative', viewerId: 'viewer-1', titleId: 'anchor:negative', reaction: 'disliked', strength: 1, mechanisms: { positive: [], negative: ['unrootable-protagonist', 'moral-identification'] } },
  { id: 'anchor-v2', viewerId: 'viewer-2', titleId: 'anchor:v2', reaction: 'loved', strength: 1, mechanisms: { positive: ['unrootable-protagonist'], negative: [] } }
]
const before = structuredClone({ titles, reactions, evidence: preview.records })
const score = (title, viewerId, otherViewerId) => scoreRecommendationCandidate({ title, viewerId, otherViewerId, titles, reactions, candidateEvidence: preview.records })
const fitOne = score(titles[0], 'viewer-1', 'viewer-2')
const riskOne = score(titles[1], 'viewer-1', 'viewer-2')
const missingOne = score(titles[2], 'viewer-1', 'viewer-2')
const riskTwo = score(titles[1], 'viewer-2', 'viewer-1')
assert.equal(fitOne.score > missingOne.score, true)
assert.equal(riskOne.score < missingOne.score, true)
assert.equal(riskOne.score <= missingOne.score - 15, true)
assert.equal(riskTwo.score > riskOne.score, true)
assert.equal(missingOne.confidence < fitOne.confidence, true)
assert.equal(fitOne.reasons.join(' ').includes('Synthetic reviewer evidence'), true)
assert.equal(jointScore(fitOne, riskTwo).value > jointScore(riskOne, riskTwo).value, true)

const unmatchedEvidence = [...preview.records, { id: 'evidence-unmatched', target: { provider: 'tmdb', externalId: '104', mediaType: 'tv' }, attributes: [{ attribute: 'synthetic-unmatched', direction: 'present', value: 1, confidence: 1, mechanisms: ['no-learned-mechanism'], source: 'synthetic-human-curation', rationale: 'Synthetic unmatched evidence.' }] }]
const tracedRisk = traceRecommendationCandidate({ title: titles[1], viewerId: 'viewer-1', otherViewerId: 'viewer-2', titles, reactions, candidateEvidence: preview.records })
const tracedUnmatched = traceRecommendationCandidate({ title: titles[3], viewerId: 'viewer-1', otherViewerId: 'viewer-2', titles, reactions, candidateEvidence: unmatchedEvidence })
const traceTotal = tracedRisk.trace.baseScore + tracedRisk.trace.explicitAnchorContribution + tracedRisk.trace.behavioralContribution + tracedRisk.trace.crossViewerContribution + tracedRisk.trace.titleMechanismContribution + tracedRisk.trace.candidateEvidenceContribution
assert.equal(tracedRisk.trace.candidateEvidenceContribution < 0, true)
assert.equal(tracedRisk.trace.candidateEvidenceContribution <= -15, true)
assert.equal(tracedRisk.confidence > missingOne.confidence, true)
assert.equal(tracedRisk.trace.finalScore, tracedRisk.score)
assert.equal(traceTotal, tracedRisk.trace.totalBeforeClamp)
assert.equal(tracedUnmatched.trace.candidateEvidenceContribution, 0)
assert.equal(tracedUnmatched.trace.candidateEvidence.unmatchedAttributes[0].attribute, 'synthetic-unmatched')
assert.equal(tracedUnmatched.trace.candidateEvidence.unmatchedViewerMechanisms.includes('credible-professional-behavior'), true)

const semanticReactions = [
  { id: 'positive-moral', viewerId: 'viewer-1', titleId: 'positive', reaction: 'loved', strength: 1, mechanisms: { positive: ['moral-identification'], negative: [] } },
  { id: 'negative-moral', viewerId: 'viewer-1', titleId: 'negative', reaction: 'disliked', strength: 1, mechanisms: { positive: [], negative: ['moral-identification', 'unrootable-protagonist'] } }
]
const semanticWeights = learnMechanismWeights(semanticReactions, 'viewer-1')
assert.equal(semanticWeights.get('moral-identification') > 0, true)
assert.equal(semanticWeights.get('moral-identification-risk') < 0, true)
assert.equal(semanticWeights.get('unrootable-protagonist') < 0, true)
const semanticTitle = { id: 'candidate:semantic-risk', title: 'Synthetic Criminal Risk', type: 'series', externalIds: { tmdb: '105' } }
const brutalityTitle = { id: 'candidate:brutality-risk', title: 'Synthetic Brutality Risk', type: 'series', externalIds: { tmdb: '106' } }
const semanticEvidence = [
  { id: 'criminal-risk', target: { provider: 'tmdb', externalId: '105', mediaType: 'tv' }, attributes: [{ attribute: 'criminal-protagonist-risk', direction: 'present', value: 1, confidence: 1, mechanisms: ['unrootable-protagonist', 'moral-identification'], source: 'synthetic-human-curation', rationale: 'Synthetic criminal-protagonist risk.' }] },
  { id: 'brutality-risk', target: { provider: 'tmdb', externalId: '106', mediaType: 'tv' }, attributes: [{ attribute: 'violence-brutality-intensity', direction: 'present', value: 1, confidence: 1, mechanisms: ['excessive-brutality'], source: 'synthetic-human-curation', rationale: 'Synthetic excessive brutality.' }] }
]
const semanticTrace = traceRecommendationCandidate({ title: semanticTitle, viewerId: 'viewer-1', otherViewerId: 'viewer-2', reactions: semanticReactions, candidateEvidence: semanticEvidence })
const unsupportedBrutality = traceRecommendationCandidate({ title: brutalityTitle, viewerId: 'viewer-1', otherViewerId: 'viewer-2', reactions: semanticReactions, candidateEvidence: semanticEvidence })
const supportedBrutality = traceRecommendationCandidate({ title: brutalityTitle, viewerId: 'viewer-1', otherViewerId: 'viewer-2', reactions: [...semanticReactions, { id: 'negative-brutality', viewerId: 'viewer-1', titleId: 'brutality-anchor', reaction: 'disliked', strength: 1, mechanisms: { positive: [], negative: ['excessive-brutality'] } }], candidateEvidence: semanticEvidence })
assert.equal(semanticTrace.trace.candidateEvidenceContribution < 0, true)
assert.equal(semanticTrace.trace.candidateEvidence.matched[0].mechanisms.includes('moral-identification'), false)
assert.equal(unsupportedBrutality.trace.candidateEvidenceContribution, 0)
assert.equal(supportedBrutality.trace.candidateEvidenceContribution < 0, true)
assert.deepEqual({ titles, reactions, evidence: preview.records }, before)

console.log('Candidate enrichment checks passed.')
