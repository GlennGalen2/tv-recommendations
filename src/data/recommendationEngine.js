import { deriveBehavioralPreferenceEvidence } from './privatePreferences.js'

export const REACTION_WEIGHTS = Object.freeze({ loved: 1, liked: 0.65, okay: 0.05, disliked: -0.7, abandoned: -1, unknown: 0 })
export const BEHAVIORAL_WEIGHTS = Object.freeze({ completed_available_run: 0.35, near_complete: 0.25, substantial_viewing: 0.15, repeat_viewing: 0.18, early_abandonment: -0.25, availability_uncertain: 0 })
export const CANDIDATE_EVIDENCE_WEIGHT = 22

function clamp(value, minimum = 0, maximum = 100) { return Math.min(maximum, Math.max(minimum, value)) }
function latestReactions(reactions) {
  const superseded = new Set(reactions.map(record => record.supersedesReactionId).filter(Boolean))
  return reactions.filter(record => !superseded.has(record.id))
}
function titleMechanisms(title) {
  const mechanisms = title.metadata?.mechanisms || title.mechanisms || {}
  return { positive: Array.isArray(mechanisms.positive) ? mechanisms.positive : [], negative: Array.isArray(mechanisms.negative) ? mechanisms.negative : [] }
}
function watchedIds(events, viewerId) {
  return new Set(events.filter(event => event.eventType === 'playback' && event.viewerIds?.includes(viewerId)).map(event => event.titleId))
}

export function learnMechanismWeights(reactions, viewerId) {
  const weights = new Map()
  for (const reaction of latestReactions(reactions).filter(record => record.viewerId === viewerId)) {
    const magnitude = Math.abs(REACTION_WEIGHTS[reaction.reaction] || 0) * (reaction.strength ?? 1)
    for (const mechanism of reaction.mechanisms?.positive || []) weights.set(mechanism, (weights.get(mechanism) || 0) + magnitude)
    for (const mechanism of reaction.mechanisms?.negative || []) weights.set(mechanism, (weights.get(mechanism) || 0) - magnitude)
  }
  return weights
}

function behavioralByViewerTitle(events, titles, resolutions, suppliedEvidence) {
  const records = suppliedEvidence || deriveBehavioralPreferenceEvidence({ events, titles, resolutions })
  const result = new Map()
  for (const record of records) {
    const key = `${record.viewerId}:${record.titleId}`
    const list = result.get(key) || []
    list.push(record)
    result.set(key, list)
  }
  return result
}

function scoreMechanisms(title, learnedWeights) {
  const mechanisms = titleMechanisms(title)
  const values = [
    ...mechanisms.positive.map(name => ({ name, value: learnedWeights.get(name) || 0 })),
    ...mechanisms.negative.map(name => ({ name, value: -(learnedWeights.get(name) || 0) }))
  ].filter(item => item.value)
  const magnitude = [...learnedWeights.values()].reduce((sum, value) => sum + Math.abs(value), 0) || 1
  return { value: clamp(values.reduce((sum, item) => sum + item.value, 0) / magnitude, -1, 1), reasons: values.sort((left, right) => Math.abs(right.value) - Math.abs(left.value)).slice(0, 2) }
}

function candidateEvidenceKey(title) {
  const mediaType = title.type === 'series' || title.mediaType === 'tv' ? 'tv' : title.type === 'movie' || title.mediaType === 'movie' ? 'movie' : null
  const externalId = title.externalIds?.tmdb || title.externalId || null
  return mediaType && externalId ? `tmdb:${mediaType}:${externalId}` : null
}

function currentCandidateEvidence(records = []) {
  const superseded = new Set(records.map(record => record.supersedesEvidenceId).filter(Boolean))
  return records.filter(record => !superseded.has(record.id))
}

function scoreCandidateEvidence(title, learnedWeights, records = []) {
  const key = candidateEvidenceKey(title)
  const record = key && currentCandidateEvidence(records).find(candidate => `${candidate.target?.provider}:${candidate.target?.mediaType}:${candidate.target?.externalId}` === key)
  if (!record) return { value: 0, confidence: 0, reasons: [], evidenceId: null }
  const values = record.attributes.map(attribute => {
    const mechanismValue = attribute.mechanisms.reduce((sum, mechanism) => sum + (learnedWeights.get(mechanism) || 0), 0) / attribute.mechanisms.length
    return { attribute, value: mechanismValue * attribute.value * attribute.confidence * (attribute.direction === 'absent' ? -1 : 1) }
  }).filter(item => item.value)
  const magnitude = [...learnedWeights.values()].reduce((sum, value) => sum + Math.abs(value), 0) || 1
  return {
    value: clamp(values.reduce((sum, item) => sum + item.value, 0) / magnitude, -1, 1),
    confidence: Math.max(...record.attributes.map(attribute => attribute.confidence), 0),
    reasons: values.sort((left, right) => Math.abs(right.value) - Math.abs(left.value)).slice(0, 2),
    evidenceId: record.id
  }
}

function scoreViewer({ title, viewerId, otherViewerId, reactionsByKey, behavioral, learnedWeights, candidateEvidence = [] }) {
  const explicit = reactionsByKey.get(`${viewerId}:${title.id}`)
  const behavior = behavioral.get(`${viewerId}:${title.id}`) || []
  const otherExplicit = reactionsByKey.get(`${otherViewerId}:${title.id}`)
  const mechanism = scoreMechanisms(title, learnedWeights)
  const curatedCandidateEvidence = scoreCandidateEvidence(title, learnedWeights, candidateEvidence)
  const reasons = []
  let delta = 0
  let confidence = 0.15

  if (explicit) {
    const value = REACTION_WEIGHTS[explicit.reaction] * (explicit.strength ?? 1)
    delta += value * 50
    confidence = 0.95
    reasons.push(`Your explicit ${explicit.reaction} reaction is the strongest signal.`)
  } else {
    const behavioralDelta = behavior.reduce((sum, record) => sum + (BEHAVIORAL_WEIGHTS[record.signal] || 0) * record.confidence, 0)
    if (behavioralDelta) {
      delta += behavioralDelta * 35
      confidence = Math.max(confidence, ...behavior.map(record => record.confidence || 0))
      const strongest = [...behavior].sort((left, right) => Math.abs((BEHAVIORAL_WEIGHTS[right.signal] || 0) * right.confidence) - Math.abs((BEHAVIORAL_WEIGHTS[left.signal] || 0) * left.confidence))[0]
      reasons.push(`Behavioral signal: ${strongest.signal.replaceAll('_', ' ')} (probabilistic).`)
    }
    if (otherExplicit) {
      const value = REACTION_WEIGHTS[otherExplicit.reaction] * (otherExplicit.strength ?? 1)
      delta += value * 16
      confidence = Math.max(confidence, 0.55)
      reasons.push(`${otherViewerId === 'viewer-1' ? 'Viewer 1' : 'Viewer 2'} explicitly ${otherExplicit.reaction} it.`)
    }
  }

  if (mechanism.value) {
    delta += mechanism.value * CANDIDATE_EVIDENCE_WEIGHT
    confidence = Math.max(confidence, 0.5)
    const top = mechanism.reasons[0]
    reasons.push(`${top.value > 0 ? 'Fits' : 'Conflicts with'} the ${top.name.replaceAll('-', ' ')} preference anchor.`)
  }
  if (curatedCandidateEvidence.value) {
    delta += curatedCandidateEvidence.value * CANDIDATE_EVIDENCE_WEIGHT
    confidence = Math.max(confidence, curatedCandidateEvidence.confidence * 0.7)
    const top = curatedCandidateEvidence.reasons[0]
    reasons.push(`${top.value > 0 ? 'Curated candidate evidence fits' : 'Curated candidate evidence conflicts with'} ${top.attribute.attribute.replaceAll('-', ' ')} (${top.attribute.source}): ${top.attribute.rationale}`)
  }
  if (explicit && behavior.some(record => (REACTION_WEIGHTS[explicit.reaction] > 0 && BEHAVIORAL_WEIGHTS[record.signal] < 0) || (REACTION_WEIGHTS[explicit.reaction] < 0 && BEHAVIORAL_WEIGHTS[record.signal] > 0))) {
    reasons.push('Contradictory behavioral evidence is retained but does not override the explicit reaction.')
  }
  if (!reasons.length) reasons.push('No direct preference evidence yet; this is neutral rather than a negative inference.')
  return { viewerId, score: Math.round(clamp(50 + delta)), confidence: Math.round(confidence * 100) / 100, reasons, explicitReaction: explicit?.reaction || null, candidateEvidenceId: curatedCandidateEvidence.evidenceId }
}

export function jointScore(viewerOne, viewerTwo) {
  const average = (viewerOne.score + viewerTwo.score) / 2
  const disagreement = Math.abs(viewerOne.score - viewerTwo.score)
  const value = Math.round(clamp((Math.min(viewerOne.score, viewerTwo.score) * 0.65) + (average * 0.35) - (disagreement * 0.3)))
  const explanation = disagreement >= 25
    ? `Joint score reduced by a ${disagreement}-point Viewer 1 / Viewer 2 disagreement.`
    : 'Joint score favors the lower individual score, not a simple average.'
  return { value, disagreement, explanation }
}

export function scoreRecommendationCandidate({ title, viewerId, otherViewerId, titles = [], events = [], reactions = [], resolutions = [], behavioralEvidence = null, candidateEvidence = [] }) {
  const currentReactions = latestReactions(reactions)
  const reactionsByKey = new Map(currentReactions.map(record => [`${record.viewerId}:${record.titleId}`, record]))
  const behavioral = behavioralByViewerTitle(events, titles, resolutions, behavioralEvidence)
  return scoreViewer({ title, viewerId, otherViewerId, reactionsByKey, behavioral, learnedWeights: learnMechanismWeights(currentReactions, viewerId), candidateEvidence })
}

export function deriveRecommendations({ titles = [], events = [], reactions = [], resolutions = [], behavioralEvidence = null, candidateEvidence = [], viewerIds = ['viewer-1', 'viewer-2'] }) {
  const [viewerOne, viewerTwo] = viewerIds
  const currentReactions = latestReactions(reactions)
  const reactionsByKey = new Map(currentReactions.map(record => [`${record.viewerId}:${record.titleId}`, record]))
  const behavioral = behavioralByViewerTitle(events, titles, resolutions, behavioralEvidence)
  const weights = new Map(viewerIds.map(viewerId => [viewerId, learnMechanismWeights(currentReactions, viewerId)]))
  const watched = new Map(viewerIds.map(viewerId => [viewerId, watchedIds(events, viewerId)]))
  const all = titles.filter(title => title?.id && title.title).map(title => {
    const viewerOneScore = scoreViewer({ title, viewerId: viewerOne, otherViewerId: viewerTwo, reactionsByKey, behavioral, learnedWeights: weights.get(viewerOne), candidateEvidence })
    const viewerTwoScore = scoreViewer({ title, viewerId: viewerTwo, otherViewerId: viewerOne, reactionsByKey, behavioral, learnedWeights: weights.get(viewerTwo), candidateEvidence })
    const joint = jointScore(viewerOneScore, viewerTwoScore)
    return { titleId: title.id, title: title.title, mediaType: title.type || 'unknown', canonical: title.externalIds?.tmdb ? `tmdb:${title.externalIds.tmdb}` : null, watchedBy: Object.fromEntries(viewerIds.map(viewerId => [viewerId, watched.get(viewerId).has(title.id)])), viewerScores: [viewerOneScore, viewerTwoScore], joint, explanation: [...viewerOneScore.reasons, ...viewerTwoScore.reasons, joint.explanation].slice(0, 3) }
  })
  const knownFor = (item, viewerId) => item.watchedBy[viewerId] || reactionsByKey.has(`${viewerId}:${item.titleId}`)
  const excludedExplicit = viewerId => all.filter(item => !item.watchedBy[viewerId] && reactionsByKey.has(`${viewerId}:${item.titleId}`)).length
  const candidatesFor = viewerId => all.filter(item => !knownFor(item, viewerId)).sort((left, right) => right.viewerScores.find(score => score.viewerId === viewerId).score - left.viewerScores.find(score => score.viewerId === viewerId).score || left.title.localeCompare(right.title))
  const jointCandidates = all.filter(item => !knownFor(item, viewerOne) && !knownFor(item, viewerTwo)).sort((left, right) => right.joint.value - left.joint.value || left.title.localeCompare(right.title))
  const jointExplicitExclusions = all.filter(item => !item.watchedBy[viewerOne] && !item.watchedBy[viewerTwo] && (reactionsByKey.has(`${viewerOne}:${item.titleId}`) || reactionsByKey.has(`${viewerTwo}:${item.titleId}`))).length
  return { generated: true, persisted: false, candidateCounts: Object.fromEntries([...viewerIds.map(viewerId => [viewerId, candidatesFor(viewerId).length]), ['joint', jointCandidates.length]]), explicitAnchorExclusions: { [viewerOne]: excludedExplicit(viewerOne), [viewerTwo]: excludedExplicit(viewerTwo), joint: jointExplicitExclusions }, viewerOne: candidatesFor(viewerOne), viewerTwo: candidatesFor(viewerTwo), joint: jointCandidates, mechanismWeights: Object.fromEntries(viewerIds.map(viewerId => [viewerId, Object.fromEntries(weights.get(viewerId))])) }
}
