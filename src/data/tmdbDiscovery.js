import { PRIVATE_STORES, getPrivateIdentityResolutionReview, listPrivateRecords } from './privateStore.js'
import { REACTION_WEIGHTS, jointScore, scoreRecommendationCandidate } from './recommendationEngine.js'
import { fetchTmdbDiscoveryDetails, fetchTmdbWorkRecommendations } from './tmdbDiscoveryClient.js'
import { normalizeAmazonLookupTitle } from './amazonLookupTitle.js'
import { normalizeNetflixLookupTitle } from './netflixLookupTitle.js'

export const DISCOVERY_SEED_LIMIT = 12
export const DISCOVERY_CANDIDATE_LIMIT = 40
export const DISCOVERY_DETAIL_LIMIT = 25

const POSITIVE_REACTIONS = new Set(['loved', 'liked'])
const DISCOVERY_SUPPORT_MAXIMUM = 18

function latest(records = [], supersededField) {
  const superseded = new Set(records.map(record => record[supersededField]).filter(Boolean))
  return records.filter(record => !superseded.has(record.id))
}

function mediaType(candidate) { return candidate.mediaType === 'movie' ? 'movie' : 'tv' }
function titleType(candidate) { return mediaType(candidate) === 'movie' ? 'movie' : 'series' }
function candidateKey(candidate) { return `tmdb:${mediaType(candidate)}:${candidate.externalId}` }
function normalizeTitle(value) { return String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ') }
function compatibleTitleType(title, candidate) { return title?.type === 'unknown' || !title?.type || title.type === titleType(candidate) }
function positiveStrength(reaction) { return Math.max(0, REACTION_WEIGHTS[reaction.reaction] || 0) * (reaction.strength ?? 1) }

function lookupTitles(title) {
  const values = [title.title, title.originalTitle].filter(Boolean)
  if (title.provenance?.sourceId === 'source:amazon-prime-video') values.push(normalizeAmazonLookupTitle(title.originalTitle || title.title).searchTitle)
  if (title.provenance?.sourceId === 'source:netflix') values.push(normalizeNetflixLookupTitle(title.originalTitle || title.title).searchTitle)
  return values
}

export function selectDiscoverySeeds({ titles = [], reactions = [], resolutions = [] }, limit = DISCOVERY_SEED_LIMIT) {
  const titlesById = new Map(titles.map(title => [title.id, title]))
  const currentReactions = latest(reactions, 'supersedesReactionId')
  const byTitle = new Map()
  for (const reaction of currentReactions.filter(reaction => POSITIVE_REACTIONS.has(reaction.reaction))) {
    const records = byTitle.get(reaction.titleId) || []
    records.push(reaction)
    byTitle.set(reaction.titleId, records)
  }
  const grouped = new Map()
  for (const resolution of latest(resolutions, 'supersedesResolutionId')) {
    if (resolution.status !== 'manually-confirmed' || resolution.candidate?.provider !== 'tmdb' || !resolution.candidate.externalId) continue
    const reactionsForTitle = byTitle.get(resolution.sourceTitleId) || []
    if (!reactionsForTitle.length) continue
    const key = candidateKey(resolution.candidate)
    const current = grouped.get(key) || { key, provider: 'tmdb', externalId: String(resolution.candidate.externalId), mediaType: mediaType(resolution.candidate), canonicalTitle: resolution.candidate.canonicalTitle, titleIds: [], reactions: [], mechanisms: new Set() }
    current.titleIds.push(resolution.sourceTitleId)
    current.reactions.push(...reactionsForTitle)
    for (const reaction of reactionsForTitle) for (const mechanism of [...(reaction.mechanisms?.positive || []), ...(reaction.mechanisms?.negative || [])]) current.mechanisms.add(mechanism)
    grouped.set(key, current)
  }
  const available = [...grouped.values()].map(seed => ({ ...seed, mechanisms: [...seed.mechanisms].sort(), priority: seed.reactions.reduce((total, reaction) => total + positiveStrength(reaction), 0) + (new Set(seed.reactions.map(reaction => reaction.viewerId)).size > 1 ? 1 : 0) }))
  const selected = []
  const remaining = new Set(available)
  while (selected.length < limit && remaining.size) {
    const next = [...remaining].sort((left, right) => {
      const novelty = seed => seed.mechanisms.filter(mechanism => !selected.some(existing => existing.mechanisms.includes(mechanism))).length * 0.15 + (!selected.some(existing => existing.mediaType === seed.mediaType) ? 0.1 : 0)
      return (right.priority + novelty(right)) - (left.priority + novelty(left)) || left.canonicalTitle.localeCompare(right.canonicalTitle)
    })[0]
    selected.push(next)
    remaining.delete(next)
  }
  return selected
}

function knownCandidateForViewer(candidate, viewerId, records, currentReactions, latestResolutions) {
  const matchedTitleIds = new Set()
  for (const title of records.titles || []) {
    const resolution = latestResolutions.get(title.id)
    const exactCanonical = resolution?.status === 'manually-confirmed' && resolution.candidate?.provider === 'tmdb' && candidateKey(resolution.candidate) === candidateKey(candidate)
    const directCanonical = title.externalIds?.tmdb && String(title.externalIds.tmdb) === String(candidate.externalId) && compatibleTitleType(title, candidate)
    const exactText = compatibleTitleType(title, candidate) && lookupTitles(title).some(value => normalizeTitle(value) === normalizeTitle(candidate.canonicalTitle))
    if (exactCanonical || directCanonical || exactText) matchedTitleIds.add(title.id)
  }
  const watched = (records.events || []).some(event => event.eventType === 'playback' && event.viewerIds?.includes(viewerId) && matchedTitleIds.has(event.titleId))
  const rated = currentReactions.some(reaction => reaction.viewerId === viewerId && matchedTitleIds.has(reaction.titleId))
  return { watched, rated, excluded: watched || rated }
}

export function applyDiscoveryExclusions(candidates, records) {
  const currentReactions = latest(records.reactions, 'supersedesReactionId')
  const latestResolutions = new Map(latest(records.resolutions, 'supersedesResolutionId').map(record => [record.sourceTitleId, record]))
  return candidates.map(candidate => ({
    ...candidate,
    exclusions: Object.fromEntries(['viewer-1', 'viewer-2'].map(viewerId => [viewerId, knownCandidateForViewer(candidate, viewerId, records, currentReactions, latestResolutions)]))
  }))
}

function addCandidate(map, candidate, seed) {
  const key = candidateKey(candidate)
  const current = map.get(key) || { ...candidate, id: `discovery:${key}`, discoverySeeds: [] }
  if (!current.discoverySeeds.some(existing => existing.key === seed.key)) {
    current.discoverySeeds.push({ key: seed.key, canonicalTitle: seed.canonicalTitle, mediaType: seed.mediaType, externalId: seed.externalId, reactions: seed.reactions.map(reaction => ({ viewerId: reaction.viewerId, reaction: reaction.reaction, strength: reaction.strength ?? 1 })) })
  }
  map.set(key, current)
}

function supportFor(candidate, viewerId) {
  const support = candidate.discoverySeeds.reduce((total, seed) => total + seed.reactions.filter(reaction => reaction.viewerId === viewerId).reduce((sum, reaction) => sum + positiveStrength(reaction), 0), 0)
  return Math.min(1, support / 1.5)
}

function scoreDiscoveredCandidate(candidate, records) {
  const oneBase = scoreRecommendationCandidate({ title: candidate, viewerId: 'viewer-1', otherViewerId: 'viewer-2', titles: records.titles, events: records.events, reactions: records.reactions, resolutions: records.resolutions, candidateEvidence: records.candidateEvidence })
  const twoBase = scoreRecommendationCandidate({ title: candidate, viewerId: 'viewer-2', otherViewerId: 'viewer-1', titles: records.titles, events: records.events, reactions: records.reactions, resolutions: records.resolutions, candidateEvidence: records.candidateEvidence })
  const scoreFor = base => {
    const support = supportFor(candidate, base.viewerId)
    const sources = candidate.discoverySeeds.filter(seed => seed.reactions.some(reaction => reaction.viewerId === base.viewerId)).map(seed => seed.canonicalTitle)
    const increment = Math.round(support * DISCOVERY_SUPPORT_MAXIMUM)
    return {
      ...base,
      score: Math.min(100, base.score + increment),
      confidence: Math.max(base.confidence, support ? 0.28 : base.confidence),
      reasons: support ? [`TMDb recommended it from ${sources.length} confirmed positive anchor${sources.length === 1 ? '' : 's'}: ${sources.slice(0, 2).join(', ')}.`, ...base.reasons].slice(0, 3) : base.reasons,
      discoverySupport: support
    }
  }
  const viewerOne = scoreFor(oneBase)
  const viewerTwo = scoreFor(twoBase)
  return { ...candidate, viewerScores: [viewerOne, viewerTwo], joint: jointScore(viewerOne, viewerTwo), explanation: [...viewerOne.reasons, ...viewerTwo.reasons].slice(0, 3) }
}

function candidatePriority(candidate) {
  return candidate.discoverySeeds.reduce((total, seed) => total + seed.reactions.reduce((sum, reaction) => sum + positiveStrength(reaction), 0), 0)
}

function safeError(error, stage, seed = null) {
  const status = error?.status || null
  const message = status === 401 ? 'TMDb rejected the configured read token.'
    : status === 403 ? 'TMDb denied access for the configured read token.'
      : status === 429 ? 'TMDb rate-limited discovery; retry later.'
        : 'TMDb discovery was unavailable (network or browser restriction).'
  return { stage, seedKey: seed?.key || null, status, message }
}

async function bounded(items, maximum, work, onProgress) {
  const results = []
  let cursor = 0
  let halted = false
  async function worker() {
    while (!halted) {
      const index = cursor++
      if (index >= items.length) return
      const item = items[index]
      try { results[index] = { item, value: await work(item) } }
      catch (error) {
        results[index] = { item, error }
        if (error?.status === 429) halted = true
      }
      await onProgress({ processed: Math.min(cursor, items.length), total: items.length, halted })
    }
  }
  await Promise.all(Array.from({ length: Math.min(maximum, items.length) }, worker))
  return { results: results.filter(Boolean), halted }
}

export async function runTmdbDiscoveryFromRecords(records, {
  fetchRecommendations = fetchTmdbWorkRecommendations,
  fetchDetails = fetchTmdbDiscoveryDetails,
  onProgress = () => {},
  seedLimit = DISCOVERY_SEED_LIMIT,
  candidateLimit = DISCOVERY_CANDIDATE_LIMIT,
  detailLimit = DISCOVERY_DETAIL_LIMIT,
  concurrency = 2
} = {}) {
  const seeds = selectDiscoverySeeds(records, seedLimit)
  const recommendationRun = await bounded(seeds, Math.min(2, Math.max(1, concurrency)), seed => fetchRecommendations({ seed }), progress => onProgress({ stage: 'discovering', ...progress }))
  const errors = recommendationRun.results.filter(result => result.error).map(result => safeError(result.error, 'recommendations', result.item))
  const candidatesByKey = new Map()
  for (const result of recommendationRun.results) if (result.value) for (const candidate of result.value) addCandidate(candidatesByKey, candidate, result.item)
  const excluded = applyDiscoveryExclusions([...candidatesByKey.values()], records)
  const candidates = excluded.filter(candidate => !candidate.exclusions['viewer-1'].excluded || !candidate.exclusions['viewer-2'].excluded)
    .sort((left, right) => candidatePriority(right) - candidatePriority(left) || left.canonicalTitle.localeCompare(right.canonicalTitle)).slice(0, candidateLimit)
  const detailTargets = candidates.slice(0, detailLimit)
  const detailRun = await bounded(detailTargets, Math.min(2, Math.max(1, concurrency)), candidate => fetchDetails({ candidate }), progress => onProgress({ stage: 'enriching', ...progress }))
  errors.push(...detailRun.results.filter(result => result.error).map(result => safeError(result.error, 'details')))
  const detailsByKey = new Map(detailRun.results.filter(result => result.value).map(result => [candidateKey(result.item), result.value]))
  const enriched = candidates.map(candidate => detailsByKey.get(candidateKey(candidate)) ? { ...detailsByKey.get(candidateKey(candidate)), id: candidate.id, discoverySeeds: candidate.discoverySeeds, exclusions: candidate.exclusions } : candidate)
  const scored = enriched.map(candidate => scoreDiscoveredCandidate(candidate, records))
  const forViewer = viewerId => scored.filter(candidate => !candidate.exclusions[viewerId].excluded).sort((left, right) => right.viewerScores.find(score => score.viewerId === viewerId).score - left.viewerScores.find(score => score.viewerId === viewerId).score || left.canonicalTitle.localeCompare(right.canonicalTitle))
  const joint = scored.filter(candidate => !candidate.exclusions['viewer-1'].excluded && !candidate.exclusions['viewer-2'].excluded).sort((left, right) => right.joint.value - left.joint.value || left.canonicalTitle.localeCompare(right.canonicalTitle))
  return {
    generated: true, persisted: false, seeds, candidates: scored,
    candidateCounts: { 'viewer-1': forViewer('viewer-1').length, 'viewer-2': forViewer('viewer-2').length, joint: joint.length },
    viewerOne: forViewer('viewer-1'), viewerTwo: forViewer('viewer-2'), joint,
    errors, halted: recommendationRun.halted || detailRun.halted,
    haltedReason: (recommendationRun.halted || detailRun.halted) ? 'TMDb rate-limited discovery. Retry later; no private data was changed.' : null
  }
}

export async function runTmdbDiscovery({ listRecords = listPrivateRecords, getIdentityReview = getPrivateIdentityResolutionReview, ...options } = {}) {
  const [titles, events, reactions, review, candidateEvidence] = await Promise.all([
    listRecords(PRIVATE_STORES.titles), listRecords(PRIVATE_STORES.historyEvents),
    listRecords(PRIVATE_STORES.reactions), getIdentityReview(), listRecords(PRIVATE_STORES.candidateEvidence)
  ])
  return runTmdbDiscoveryFromRecords({ titles, events, reactions, resolutions: review.resolutions, candidateEvidence }, options)
}
