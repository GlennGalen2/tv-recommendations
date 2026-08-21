import { evaluateCandidate, validateResearchPacket } from './evaluator.js'
import { researchCandidate, validateResearchTarget } from './research.js'
import { validateLlmCandidateBatch } from '../src/data/llmEvaluationBatch.js'

export const RESEARCH_QUEUE_FORMAT = 'tv-recommendations-private-research-queue'
export const RESEARCH_QUEUE_VERSION = 1

function requireText(value, message) { if (typeof value !== 'string' || !value.trim()) throw new TypeError(message) }
function requirePositiveInteger(value, message) { if (!Number.isInteger(value) || value < 1) throw new TypeError(message) }
function safeError(error) { return { type: error?.type || 'unknown_failure', code: error?.code || null, message: error?.message || 'Private queue item failed.' } }
function targetFrom(candidate) {
  return {
    provider: candidate.target.provider,
    externalId: candidate.target.externalId,
    title: candidate.target.canonicalTitle,
    mediaType: candidate.target.mediaType,
    year: candidate.target.releaseYear ?? null
  }
}

export function createPrivateResearchQueue({ candidateBatch, id = `research-queue-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`, maxCostCents = 100, reservedCostCentsPerCandidate = 3, createdAt = new Date().toISOString() } = {}) {
  validateLlmCandidateBatch(candidateBatch)
  requireText(id, 'Private research queue requires an ID.')
  requirePositiveInteger(maxCostCents, 'Private research queue requires a positive cost cap in cents.')
  requirePositiveInteger(reservedCostCentsPerCandidate, 'Private research queue requires a positive per-candidate reservation in cents.')
  return validatePrivateResearchQueue({
    format: RESEARCH_QUEUE_FORMAT,
    formatVersion: RESEARCH_QUEUE_VERSION,
    id,
    createdAt,
    sourceCandidateBatch: { id: candidateBatch.id, createdAt: candidateBatch.createdAt },
    budget: { maxCostCents, reservedCostCentsPerCandidate },
    items: candidateBatch.candidates.map(candidate => ({
      id: `${candidate.target.provider}:${candidate.target.mediaType}:${candidate.target.externalId}`,
      target: targetFrom(candidate),
      discoverySeeds: candidate.discoverySeeds,
      discoverySources: candidate.discoverySources || [],
      status: 'pending',
      attempts: 0,
      reservedCostCents: 0,
      researchPacketPath: null,
      researchMetrics: null,
      evaluation: null,
      error: null
    }))
  })
}

export function validatePrivateResearchQueue(queue) {
  if (!queue || typeof queue !== 'object' || Array.isArray(queue)) throw new TypeError('Private research queue must be an object.')
  if (queue.format !== RESEARCH_QUEUE_FORMAT || queue.formatVersion !== RESEARCH_QUEUE_VERSION) throw new TypeError('Unsupported private research queue format.')
  requireText(queue.id, 'Private research queue requires an ID.')
  if (Number.isNaN(Date.parse(queue.createdAt))) throw new TypeError('Private research queue requires a valid creation time.')
  requirePositiveInteger(queue.budget?.maxCostCents, 'Private research queue requires a positive cost cap in cents.')
  requirePositiveInteger(queue.budget?.reservedCostCentsPerCandidate, 'Private research queue requires a positive per-candidate reservation in cents.')
  if (!Array.isArray(queue.items) || !queue.items.length || queue.items.length > 100) throw new TypeError('Private research queues require 1 through 100 items.')
  const ids = new Set()
  for (const item of queue.items) {
    requireText(item.id, 'Each private research queue item requires an ID.')
    if (ids.has(item.id)) throw new TypeError('Private research queue item IDs must be unique.')
    ids.add(item.id)
    validateResearchTarget(item.target)
    if (!['pending', 'research-complete', 'completed', 'failed'].includes(item.status)) throw new TypeError('Private research queue item has an invalid status.')
    if (!Number.isInteger(item.attempts) || item.attempts < 0) throw new TypeError('Private research queue item has an invalid attempt count.')
    if (!Number.isInteger(item.reservedCostCents) || item.reservedCostCents < 0) throw new TypeError('Private research queue item has an invalid reserved cost.')
  }
  return queue
}

export function privateQueueSummary(queue) {
  validatePrivateResearchQueue(queue)
  const byStatus = Object.fromEntries(['pending', 'research-complete', 'completed', 'failed'].map(status => [status, 0]))
  for (const item of queue.items) byStatus[item.status] += 1
  const reservedCostCents = queue.items.reduce((total, item) => total + item.reservedCostCents, 0)
  return { ...byStatus, reservedCostCents, remainingCostCents: Math.max(0, queue.budget.maxCostCents - reservedCostCents) }
}

export async function runPrivateResearchQueue({ queue, researchAdapter, evaluationAdapter, viewerProfile, loadResearchPacket, saveResearchPacket, persistQueue, retryFailed = false, limit = Infinity, now = () => new Date().toISOString() } = {}) {
  validatePrivateResearchQueue(queue)
  if (!researchAdapter?.research || !evaluationAdapter?.evaluate) throw new TypeError('Private research queue requires research and evaluation adapters.')
  if (typeof viewerProfile !== 'string' || !viewerProfile.trim()) throw new TypeError('Private research queue requires a private viewer profile.')
  if (typeof loadResearchPacket !== 'function' || typeof saveResearchPacket !== 'function' || typeof persistQueue !== 'function') throw new TypeError('Private research queue requires private packet and queue storage functions.')
  let processed = 0
  for (const item of queue.items) {
    if (processed >= limit || item.status === 'completed' || (item.status === 'failed' && !retryFailed)) continue
    const needsResearch = item.status !== 'research-complete'
    if (needsResearch && privateQueueSummary(queue).reservedCostCents + queue.budget.reservedCostCentsPerCandidate > queue.budget.maxCostCents) break
    processed += 1
    item.attempts += 1
    try {
      let packet = item.researchPacketPath ? await loadResearchPacket(item.researchPacketPath) : null
      if (packet) validateResearchPacket(packet)
      if (!packet) {
        item.reservedCostCents += queue.budget.reservedCostCentsPerCandidate
        await persistQueue(queue)
        const research = await researchCandidate({ adapter: researchAdapter, target: item.target })
        packet = research.packet
        item.researchPacketPath = await saveResearchPacket({ packet, item })
        item.researchMetrics = { model: researchAdapter.model || null, latencyMs: research.latencyMs, usage: research.usage, costUsd: research.costUsd }
        item.status = 'research-complete'
        item.error = null
        await persistQueue(queue)
      }
      const evaluation = await evaluateCandidate({ adapter: evaluationAdapter, viewerProfile, researchPacket: packet })
      item.evaluation = { model: evaluationAdapter.model || null, evaluation: evaluation.evaluation, latencyMs: evaluation.latencyMs, usage: evaluation.usage, completedAt: now() }
      item.status = 'completed'
      item.error = null
    } catch (error) {
      item.status = item.researchPacketPath ? 'research-complete' : 'failed'
      item.error = safeError(error)
    }
    await persistQueue(queue)
  }
  return { queue, summary: privateQueueSummary(queue), processed }
}
