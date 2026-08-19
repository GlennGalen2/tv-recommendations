function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function candidateYear(candidate) {
  return candidate.releaseYear
    || (typeof candidate.releaseDate === 'string' ? Number(candidate.releaseDate.slice(0, 4)) : null)
    || null
}

export function createIdentityMatchQuery(sourceTitle, events = []) {
  const episodeEvent = events.find(event => event.mediaScope?.level === 'episode')
  const scope = episodeEvent?.mediaScope || {}

  return {
    normalizedTitle: normalize(sourceTitle?.title || sourceTitle?.originalTitle),
    sourceTitle: sourceTitle?.originalTitle || sourceTitle?.title || null,
    mediaTypeHint: sourceTitle?.type === 'unknown' ? null : sourceTitle?.type || null,
    releaseYearHint: sourceTitle?.releaseYear || null,
    seriesTitleHint: scope.seriesTitle || null,
    seasonNumberHint: scope.seasonNumber ?? null,
    episodeNumberHint: scope.episodeNumber ?? null,
    episodeTitleHint: scope.episodeTitle || null,
    sourceMetadata: {
      sourceId: sourceTitle?.provenance?.sourceId || null,
      externalIds: sourceTitle?.externalIds || {}
    }
  }
}

function titleMatches(query, candidate) {
  return Boolean(query.normalizedTitle) && query.normalizedTitle === normalize(candidate.canonicalTitle)
}

function compatibleType(query, candidate) {
  return !query.mediaTypeHint || query.mediaTypeHint === candidate.mediaType
}

function yearMatches(query, candidate) {
  return !query.releaseYearHint || query.releaseYearHint === candidateYear(candidate)
}

function structuralMatch(query, candidate) {
  if (query.episodeNumberHint === null || candidate.episodeNumber === undefined) return false
  return query.episodeNumberHint === candidate.episodeNumber
    && (query.seasonNumberHint === null || query.seasonNumberHint === candidate.seasonNumber)
}

export function scoreIdentityCandidate(query, candidate) {
  if (!candidate?.provider || !candidate.externalId || !candidate.canonicalTitle || !candidate.mediaType) {
    return { score: 0, reasons: ['Candidate lacks stable provider identity or canonical metadata.'] }
  }

  const exactTitle = titleMatches(query, candidate)
  const typeCompatible = compatibleType(query, candidate)
  const exactYear = yearMatches(query, candidate)
  const structural = structuralMatch(query, candidate)
  const reasons = []
  let score = 0

  if (exactTitle) {
    score += 0.7
    reasons.push('Exact normalized title match.')
  }
  if (typeCompatible && query.mediaTypeHint) {
    score += 0.1
    reasons.push('Media type agrees with the source hint.')
  }
  if (exactYear && query.releaseYearHint) {
    score += 0.2
    reasons.push('Release year agrees.')
  }
  if (structural) {
    score = Math.max(score, 0.99)
    reasons.push('Season and episode structure agrees.')
  }

  if (!exactTitle || !typeCompatible || (query.releaseYearHint && !exactYear)) {
    return { score: 0, reasons: ['Title, type, or known year conflicts with the source record.'] }
  }

  return { score: Math.min(Math.round(score * 1000) / 1000, 1), reasons }
}

export function rankIdentityCandidates(query, candidates = []) {
  return candidates
    .map(candidate => ({ ...candidate, ...scoreIdentityCandidate(query, candidate) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.externalId.localeCompare(right.externalId))
}

export function confidenceTier(score) {
  if (score >= 0.995) return 'automatic-eligible'
  if (score >= 0.85) return 'review-required'
  return 'unresolved'
}
