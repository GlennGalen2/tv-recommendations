import assert from 'node:assert/strict'
import { createLlmCandidateBatch, llmEvaluatedTargetKeys, previewLlmEvaluationBatchImport, unevaluatedLlmCandidates } from '../src/data/llmEvaluationBatch.js'
import { evaluateLlmCandidateBatch } from '../llm-eval/candidateBatch.js'

const candidateBatch = createLlmCandidateBatch([{ mediaType: 'tv', externalId: '101', canonicalTitle: 'Synthetic Candidate', releaseYear: 2025, overview: 'Synthetic overview.', discoverySeeds: [{ mediaType: 'tv', externalId: '1', canonicalTitle: 'Synthetic Seed' }], discoverySources: [{ kind: 'tmdb-watch-provider', providerId: '7', providerName: 'Synthetic Plus', mediaType: 'tv', region: 'US' }] }], { id: 'synthetic-candidates', createdAt: '2026-08-20T00:00:00.000Z' })
assert.deepEqual(candidateBatch.candidates[0].discoverySources, [{ kind: 'tmdb-watch-provider', providerId: '7', providerName: 'Synthetic Plus', mediaType: 'tv', region: 'US' }])
const cohortBatch = createLlmCandidateBatch([{ mediaType: 'movie', externalId: '202', canonicalTitle: 'Synthetic Cohort Candidate', discoveryPriority: 72, discoveryPriorityReasons: ['Synthetic triage reason.'], discoverySeeds: [], discoverySources: [{ kind: 'tmdb-quality-cohort', cohortId: 'synthetic-drama', cohortName: 'Synthetic drama', mediaType: 'movie', region: 'US', providerIds: ['8'] }] }], { id: 'synthetic-cohort-candidates', createdAt: '2026-08-20T00:00:00.000Z' })
assert.deepEqual(cohortBatch.candidates[0].discoverySources, [{ kind: 'tmdb-quality-cohort', cohortId: 'synthetic-drama', cohortName: 'Synthetic drama', mediaType: 'movie', region: 'US' }])
assert.equal(cohortBatch.candidates[0].discoveryPriority, 72)
const balancedBatch = createLlmCandidateBatch([
  { mediaType: 'movie', externalId: '301', canonicalTitle: 'Synthetic Movie One', discoverySources: [{ kind: 'tmdb-quality-cohort', cohortId: 'movies', cohortName: 'Movies', mediaType: 'movie', region: 'US' }] },
  { mediaType: 'movie', externalId: '302', canonicalTitle: 'Synthetic Movie Two', discoverySources: [{ kind: 'tmdb-quality-cohort', cohortId: 'movies', cohortName: 'Movies', mediaType: 'movie', region: 'US' }] },
  { mediaType: 'tv', externalId: '303', canonicalTitle: 'Synthetic Mystery One', discoverySources: [{ kind: 'tmdb-quality-cohort', cohortId: 'mystery', cohortName: 'Mystery', mediaType: 'tv', region: 'US' }] },
  { mediaType: 'tv', externalId: '304', canonicalTitle: 'Synthetic Political One', discoverySources: [{ kind: 'tmdb-quality-cohort', cohortId: 'political', cohortName: 'Political', mediaType: 'tv', region: 'US' }] }
], { id: 'synthetic-balanced-candidates', createdAt: '2026-08-20T00:00:00.000Z', limit: 3 })
assert.deepEqual(balancedBatch.candidates.map(candidate => candidate.target.externalId), ['301', '303', '304'])
const stratifiedCandidates = Array.from({ length: 8 }, (_, index) => ({
  mediaType: 'tv', externalId: String(400 + index), canonicalTitle: `Synthetic Stratified ${index}`,
  discoverySources: [{
    kind: 'tmdb-quality-cohort', cohortId: index % 2 ? 'mystery' : 'crime', cohortName: index % 2 ? 'Mystery' : 'Crime', mediaType: 'tv', region: 'US',
    providerGroup: index < 4 ? 'priority' : 'exploration', providerGroupName: index < 4 ? 'Priority curated services' : 'Broader-service exploration'
  }]
}))
const stratifiedBatch = createLlmCandidateBatch(stratifiedCandidates, { id: 'synthetic-stratified-candidates', createdAt: '2026-08-20T00:00:00.000Z', limit: 4 })
assert.equal(stratifiedBatch.candidates.filter(candidate => candidate.discoverySources.some(source => source.providerGroup === 'priority')).length, 3)
assert.equal(stratifiedBatch.candidates.filter(candidate => candidate.discoverySources.some(source => source.providerGroup === 'exploration')).length, 1)
const evaluation = { viewer1: { fitScore: 80, confidence: 0.7, positiveFactors: [], negativeFactors: [], redFlags: [], positiveMechanismTags: [], negativeMechanismTags: [], redFlagTags: [], rationale: 'Synthetic.' }, viewer2: { fitScore: 75, confidence: 0.6, positiveFactors: [], negativeFactors: [], redFlags: [], positiveMechanismTags: [], negativeMechanismTags: [], redFlagTags: [], rationale: 'Synthetic.' }, joint: { fitScore: 72, confidence: 0.6, keyAgreementFactors: [], keyDisagreementFactors: [], rationale: 'Synthetic.' } }
const report = await evaluateLlmCandidateBatch({ adapter: { id: 'synthetic', model: 'synthetic-model', async evaluate() { return { text: JSON.stringify(evaluation), usage: null, costUsd: null } } }, viewerProfile: '# Synthetic profile', candidateBatch, loadResearchPacket: async () => ({ title: 'Synthetic Candidate', mediaType: 'tv', synopsis: 'Synthetic.' }), now: () => '2026-08-20T01:00:00.000Z' })
assert.equal(report.evaluations.length, 1)
assert.equal(report.evaluations[0].target.externalId, '101')
assert.deepEqual(report.evaluations[0].discoverySources, candidateBatch.candidates[0].discoverySources)
const preview = previewLlmEvaluationBatchImport(JSON.stringify(report))
assert.equal(preview.importable, true)
assert.equal(previewLlmEvaluationBatchImport(JSON.stringify(report), [{ kind: 'llm-evaluation-batch', llmEvaluationBatch: report }]).duplicate, true)

const priorEvaluations = [{ kind: 'llm-evaluation-batch', llmEvaluationBatch: { evaluations: [{ target: cohortBatch.candidates[0].target }] } }]
assert.equal(llmEvaluatedTargetKeys(priorEvaluations).has('tmdb:movie:202'), true)
assert.equal(unevaluatedLlmCandidates([{ mediaType: 'movie', externalId: '202' }, { mediaType: 'movie', externalId: '999' }], priorEvaluations).length, 1)
const unevaluatedBatch = createLlmCandidateBatch([
  { mediaType: 'movie', externalId: '202', canonicalTitle: 'Already Evaluated', discoverySources: [] },
  { mediaType: 'movie', externalId: '999', canonicalTitle: 'Fresh Candidate', discoverySources: [] }
], { evaluationRecords: priorEvaluations })
assert.equal(unevaluatedBatch.candidates.length, 1)
assert.equal(unevaluatedBatch.candidates[0].target.externalId, '999')
assert.equal(previewLlmEvaluationBatchImport('{bad').importable, false)
console.log('LLM candidate-batch checks passed.')
