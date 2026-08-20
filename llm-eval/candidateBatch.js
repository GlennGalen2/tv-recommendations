import { evaluateCandidate, validateResearchPacket } from './evaluator.js'
import { LLM_BATCH_FORMAT_VERSION, LLM_EVALUATION_BATCH_FORMAT, validateLlmCandidateBatch } from '../src/data/llmEvaluationBatch.js'

export async function evaluateLlmCandidateBatch({ adapter, viewerProfile, candidateBatch, loadResearchPacket, now = () => new Date().toISOString() }) {
  validateLlmCandidateBatch(candidateBatch)
  if (typeof loadResearchPacket !== 'function') throw new TypeError('A private research-packet loader is required.')
  const evaluations = []
  for (const candidate of candidateBatch.candidates) {
    const packet = await loadResearchPacket(candidate)
    validateResearchPacket(packet)
    if (packet.mediaType !== candidate.target.mediaType) throw new TypeError('Candidate research packet media type does not match its TMDb target.')
    const response = await evaluateCandidate({ adapter, viewerProfile, researchPacket: packet })
    evaluations.push({ target: candidate.target, discoverySeeds: candidate.discoverySeeds, discoverySources: candidate.discoverySources, evaluation: response.evaluation, latencyMs: response.latencyMs, usage: response.usage, costUsd: response.costUsd })
  }
  return {
    format: LLM_EVALUATION_BATCH_FORMAT,
    formatVersion: LLM_BATCH_FORMAT_VERSION,
    id: `llm-evaluations-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`,
    provider: adapter.id,
    model: adapter.model,
    generatedAt: now(),
    sourceCandidateBatch: { id: candidateBatch.id, createdAt: candidateBatch.createdAt },
    evaluations
  }
}
