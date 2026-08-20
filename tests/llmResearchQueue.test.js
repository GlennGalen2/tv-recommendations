import assert from 'node:assert/strict'
import { createPrivateResearchQueue, privateQueueSummary, runPrivateResearchQueue } from '../llm-eval/researchQueue.js'

const candidates = {
  format: 'tv-recommendations-llm-candidate-batch', formatVersion: 1, id: 'synthetic-batch', createdAt: '2026-01-01T00:00:00.000Z',
  candidates: [
    { target: { provider: 'tmdb', mediaType: 'tv', externalId: '101', canonicalTitle: 'Synthetic First', releaseYear: 2020 }, discoverySeeds: [], discoverySources: [{ kind: 'tmdb-watch-provider', providerId: '7', providerName: 'Synthetic Plus', mediaType: 'tv', region: 'US' }] },
    { target: { provider: 'tmdb', mediaType: 'movie', externalId: '202', canonicalTitle: 'Synthetic Second', releaseYear: 2021 }, discoverySeeds: [] }
  ]
}
const packetFor = target => ({ title: target.title, year: target.year, mediaType: target.mediaType, synopsis: 'Synthetic synopsis.', criticalObservations: [], protagonistMoralSetup: 'Unknown from synthetic sources.', violenceBrutalityNotes: 'Unknown from synthetic sources.', dialogueToneNotes: 'Unknown from synthetic sources.', professionalRealismNotes: 'Unknown from synthetic sources.', storytellingMysteryNotes: 'Unknown from synthetic sources.', sources: [{ provider: 'Synthetic Review', reference: 'Synthetic One', url: 'https://example.test/review-one' }, { provider: 'Synthetic Review', reference: 'Synthetic Two', url: 'https://example.test/review-two' }], uncertainties: [] })
const evaluation = { viewer1: { fitScore: 50, confidence: 0.5, positiveFactors: [], negativeFactors: [], redFlags: [], positiveMechanismTags: [], negativeMechanismTags: [], redFlagTags: [], rationale: 'Synthetic.' }, viewer2: { fitScore: 50, confidence: 0.5, positiveFactors: [], negativeFactors: [], redFlags: [], positiveMechanismTags: [], negativeMechanismTags: [], redFlagTags: [], rationale: 'Synthetic.' }, joint: { fitScore: 50, confidence: 0.5, keyAgreementFactors: [], keyDisagreementFactors: [], rationale: 'Synthetic.' } }

const queue = createPrivateResearchQueue({ candidateBatch: candidates, id: 'synthetic-queue', maxCostCents: 3, reservedCostCentsPerCandidate: 3, createdAt: '2026-01-01T00:00:00.000Z' })
assert.equal(queue.items[0].discoverySources[0].providerName, 'Synthetic Plus')
let researchCalls = 0
let evaluationCalls = 0
let failEvaluation = true
const packets = new Map()
const persisted = []
const result = await runPrivateResearchQueue({
  queue,
  researchAdapter: { research: async () => { researchCalls += 1; return { text: JSON.stringify(packetFor(queue.items[0].target)), usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }, costUsd: 0.001 } } },
  evaluationAdapter: { evaluate: async () => { evaluationCalls += 1; if (failEvaluation) throw Object.assign(new Error('Synthetic provider failure.'), { type: 'provider_request_failed' }); return { text: JSON.stringify(evaluation) } } },
  viewerProfile: '# Synthetic profile',
  loadResearchPacket: async path => packets.get(path) || null,
  saveResearchPacket: async ({ packet, item }) => { const path = `private/${item.id}.json`; packets.set(path, packet); return path },
  persistQueue: async value => { persisted.push(structuredClone(value)) },
  limit: 2
})
assert.equal(researchCalls, 1)
assert.equal(evaluationCalls, 1)
assert.equal(result.summary['research-complete'], 1)
assert.equal(result.summary.pending, 1)
assert.equal(result.summary.reservedCostCents, 3)
assert.equal(queue.items[0].researchMetrics.usage.totalTokens, 20)
assert.equal(queue.items[0].researchMetrics.costUsd, 0.001)
assert.ok(persisted.length >= 2)

failEvaluation = false
const retry = await runPrivateResearchQueue({
  queue,
  researchAdapter: { research: async () => { throw new Error('Research should have been reused.') } },
  evaluationAdapter: { evaluate: async () => ({ text: JSON.stringify(evaluation) }) },
  viewerProfile: '# Synthetic profile',
  loadResearchPacket: async path => packets.get(path) || null,
  saveResearchPacket: async () => { throw new Error('Research should not be saved again.') },
  persistQueue: async value => { persisted.push(structuredClone(value)) },
  retryFailed: true,
  limit: 1
})
assert.equal(retry.summary.completed, 1)
assert.equal(retry.summary.pending, 1)
assert.equal(privateQueueSummary(queue).reservedCostCents, 3)

const failedResearchQueue = createPrivateResearchQueue({ candidateBatch: { ...candidates, candidates: [candidates.candidates[0]] }, id: 'failed-research-queue', maxCostCents: 3, reservedCostCentsPerCandidate: 3, createdAt: '2026-01-01T00:00:00.000Z' })
const failedResearch = await runPrivateResearchQueue({
  queue: failedResearchQueue,
  researchAdapter: { research: async () => { throw Object.assign(new Error('Synthetic research failure.'), { type: 'research_target_mismatch' }) } },
  evaluationAdapter: { evaluate: async () => { throw new Error('Evaluation should not run.') } },
  viewerProfile: '# Synthetic profile',
  loadResearchPacket: async () => null,
  saveResearchPacket: async () => { throw new Error('Research should not be saved.') },
  persistQueue: async () => {}
})
assert.equal(failedResearch.summary.failed, 1)
assert.equal(failedResearch.summary.reservedCostCents, 3)
console.log('LLM private research queue checks passed.')
