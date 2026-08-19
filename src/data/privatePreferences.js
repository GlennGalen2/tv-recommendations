const POSITIVE_REACTIONS = new Set(['loved', 'liked'])
const NEGATIVE_REACTIONS = new Set(['disliked', 'abandoned'])

function latestByViewerTitle(reactions = []) {
  const superseded = new Set(reactions.map(reaction => reaction.supersedesReactionId).filter(Boolean))
  return new Map(reactions.filter(reaction => !superseded.has(reaction.id)).map(reaction => [`${reaction.viewerId}:${reaction.titleId}`, reaction]))
}

function latestResolutionsByTitle(resolutions = []) {
  const superseded = new Set(resolutions.map(resolution => resolution.supersedesResolutionId).filter(Boolean))
  return new Map(resolutions.filter(resolution => !superseded.has(resolution.id)).map(resolution => [resolution.sourceTitleId, resolution]))
}

function canonicalKey(titleId, resolution) {
  const candidate = resolution?.candidate
  return candidate && ['manually-confirmed', 'confidently-resolved'].includes(resolution.status)
    ? `${candidate.provider}:${candidate.externalId}`
    : `source:${titleId}`
}

function evidence(id, viewerId, titleId, signal, direction, strength, confidence, eventIds, explanation, uncertainty = null) {
  return {
    id, viewerId, titleId, evidenceType: 'inferred-behavioral', signal, direction, strength, confidence,
    basedOn: eventIds.map(recordId => ({ recordType: 'history-event', recordId, weight: 1 })),
    explanation, uncertainty,
    derivation: { method: 'rule', version: 'behavioral-preferences:v1', recomputed: true }
  }
}

// Availability is optional future metadata keyed by canonical/provider identity or source title id.
// Without it, completion and abandonment remain explicitly uncertain.
export function deriveBehavioralPreferenceEvidence({ events = [], titles = [], resolutions = [], availability = {} }) {
  const resolutionsByTitle = latestResolutionsByTitle(resolutions)
  const grouped = new Map()
  for (const event of events) {
    if (event.eventType !== 'playback') continue
    for (const viewerId of event.viewerIds || []) {
      const key = `${viewerId}:${canonicalKey(event.titleId, resolutionsByTitle.get(event.titleId))}`
      const group = grouped.get(key) || { viewerId, titleId: event.titleId, events: [], episodeIds: new Set(), seasons: new Set(), canonicalKey: key.slice(viewerId.length + 1) }
      group.events.push(event)
      if (event.mediaScope?.level === 'episode' && Number.isFinite(event.mediaScope.episodeNumber)) {
        group.episodeIds.add(`${event.mediaScope.seasonNumber ?? 'unknown'}:${event.mediaScope.episodeNumber}`)
        if (Number.isFinite(event.mediaScope.seasonNumber)) group.seasons.add(event.mediaScope.seasonNumber)
      }
      grouped.set(key, group)
    }
  }

  const evidenceRecords = []
  for (const group of grouped.values()) {
    const eventIds = group.events.map(event => event.id)
    const uniqueEpisodes = group.episodeIds.size
    const available = availability[group.canonicalKey] || availability[group.titleId] || null
    const prefix = `behavior:${group.viewerId}:${group.titleId}`
    if (uniqueEpisodes && group.events.length > uniqueEpisodes) {
      evidenceRecords.push(evidence(`${prefix}:repeat`, group.viewerId, group.titleId, 'repeat_viewing', 'positive', 0.8, 0.75, eventIds, 'Playback includes repeat episodes; this is probabilistic positive evidence.'))
    }
    if (!available || !Number.isFinite(available.episodeCount) || available.episodeCount <= 0) {
      evidenceRecords.push(evidence(`${prefix}:availability`, group.viewerId, group.titleId, 'availability_uncertain', 'neutral', 0, 0.25, eventIds, 'Available episode count on the service is not established, so completion or abandonment is not inferred.', 'service-availability-unknown'))
      continue
    }
    const fraction = uniqueEpisodes / available.episodeCount
    if (fraction >= 1) {
      evidenceRecords.push(evidence(`${prefix}:completion`, group.viewerId, group.titleId, 'completed_available_run', 'positive', 0.9, available.confidence ?? 0.8, eventIds, 'All episodes known to have been available are represented in playback history.'))
    } else if (fraction >= 0.75) {
      evidenceRecords.push(evidence(`${prefix}:completion`, group.viewerId, group.titleId, 'near_complete', 'positive', 0.7, available.confidence ?? 0.7, eventIds, 'Most episodes known to have been available are represented in playback history.'))
    } else if (fraction >= 0.4) {
      evidenceRecords.push(evidence(`${prefix}:viewing`, group.viewerId, group.titleId, 'substantial_viewing', 'positive', 0.45, available.confidence ?? 0.55, eventIds, 'A substantial portion of known available episodes was viewed.'))
    } else if (fraction <= 0.25 && available.continuedAvailabilityKnown) {
      evidenceRecords.push(evidence(`${prefix}:abandonment`, group.viewerId, group.titleId, 'early_abandonment', 'negative', 0.55, available.confidence ?? 0.6, eventIds, 'Only a small portion was viewed while substantially more availability is known; this remains probabilistic.'))
    } else {
      evidenceRecords.push(evidence(`${prefix}:availability`, group.viewerId, group.titleId, 'availability_uncertain', 'neutral', 0, available.confidence ?? 0.35, eventIds, 'Viewing stopped before known completion, but continued service availability is not established.', 'continued-availability-unknown'))
    }
  }
  return evidenceRecords
}

export function derivePrivatePreferenceAnalysis({ reactions = [], events = [], titles = [], resolutions = [], availability = {} }) {
  const latest = latestByViewerTitle(reactions)
  const explicit = [...latest.values()]
  const behavioral = deriveBehavioralPreferenceEvidence({ events, titles, resolutions, availability })
  const byViewer = {}
  const mechanisms = { positive: {}, negative: {} }
  for (const reaction of explicit) {
    const summary = byViewer[reaction.viewerId] || { explicit: 0, reactions: {}, behavioralPositive: 0, behavioralNegative: 0 }
    summary.explicit += 1
    summary.reactions[reaction.reaction] = (summary.reactions[reaction.reaction] || 0) + 1
    byViewer[reaction.viewerId] = summary
    for (const mechanism of reaction.mechanisms?.positive || []) mechanisms.positive[mechanism] = (mechanisms.positive[mechanism] || 0) + 1
    for (const mechanism of reaction.mechanisms?.negative || []) mechanisms.negative[mechanism] = (mechanisms.negative[mechanism] || 0) + 1
  }
  for (const item of behavioral) {
    const summary = byViewer[item.viewerId] || { explicit: 0, reactions: {}, behavioralPositive: 0, behavioralNegative: 0 }
    if (item.direction === 'positive') summary.behavioralPositive += 1
    if (item.direction === 'negative') summary.behavioralNegative += 1
    byViewer[item.viewerId] = summary
  }
  const explicitByKey = latest
  const conflicts = behavioral.filter(item => {
    const reaction = explicitByKey.get(`${item.viewerId}:${item.titleId}`)
    return reaction && ((POSITIVE_REACTIONS.has(reaction.reaction) && item.direction === 'negative') || (NEGATIVE_REACTIONS.has(reaction.reaction) && item.direction === 'positive'))
  }).map(item => ({ ...item, explicitOverride: explicitByKey.get(`${item.viewerId}:${item.titleId}`).reaction }))
  const differences = []
  const byTitle = new Map()
  for (const reaction of explicit) {
    const list = byTitle.get(reaction.titleId) || []
    list.push(reaction)
    byTitle.set(reaction.titleId, list)
  }
  for (const [titleId, reactionsForTitle] of byTitle) if (new Set(reactionsForTitle.map(reaction => reaction.reaction)).size > 1) differences.push({ titleId, reactions: reactionsForTitle })
  return { explicit, behavioral, byViewer, mechanisms, conflicts, differences, availabilityUncertain: behavioral.filter(item => item.signal === 'availability_uncertain') }
}

export function previewExplicitPreferenceImport(jsonText, { reactions = [], titleIds = new Set(), viewerIds = new Set(), fileName = null } = {}) {
  const parsed = JSON.parse(jsonText)
  if (parsed?.format !== 'tv-recommendations-explicit-preferences' || parsed.formatVersion !== 1 || !Array.isArray(parsed.records)) throw new TypeError('Not a supported explicit-preferences JSON file.')
  const latest = latestByViewerTitle(reactions)
  const existingIds = new Set(reactions.map(reaction => reaction.id))
  const records = []
  const problems = []
  let duplicates = 0
  for (const [index, input] of parsed.records.entries()) {
    if (!input || !viewerIds.has(input.viewerId) || !titleIds.has(input.titleId) || !['loved', 'liked', 'okay', 'disliked', 'abandoned', 'unknown'].includes(input.reaction)) {
      problems.push(`Record ${index + 1} has an unknown viewer/title or reaction.`)
      continue
    }
    if (input.id && existingIds.has(input.id)) { duplicates += 1; continue }
    const previous = latest.get(`${input.viewerId}:${input.titleId}`)
    if (previous?.reaction === input.reaction) { duplicates += 1; continue }
    const record = {
      id: input.id || `rct_${crypto.randomUUID()}`, schemaVersion: 1, viewerId: input.viewerId, titleId: input.titleId,
      reaction: input.reaction, strength: Number.isFinite(input.strength) ? input.strength : 1,
      mechanisms: { positive: [...new Set(input.mechanisms?.positive || [])], negative: [...new Set(input.mechanisms?.negative || [])] },
      note: typeof input.note === 'string' ? input.note.slice(0, 500) : null,
      recordedAt: input.recordedAt || new Date().toISOString(), supersedesReactionId: previous?.id || null,
      provenance: { sourceId: 'source:manual', sourceRecordId: input.provenance?.sourceRecordId || null, importFileName: fileName || null, importFormat: 'curated-explicit-preferences:v1' }
    }
    records.push(record)
    latest.set(`${input.viewerId}:${input.titleId}`, record)
  }
  return { records, summary: { sourceRecords: parsed.records.length, importable: records.length, duplicates, problems } }
}
