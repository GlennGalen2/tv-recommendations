function unchanged(sourceTitle, reason = 'No safely separable Netflix series structure was found.') {
  return { searchTitle: sourceTitle, applied: false, transformation: 'none', reason, mediaTypeHint: null }
}

// Lookup-only: this never changes imported records, playback events, reactions, or resolutions.
export function normalizeNetflixLookupTitle(sourceTitle) {
  const original = String(sourceTitle || '').replace(/\s+/g, ' ').trim()
  if (!original) return unchanged(original, 'The Netflix source title is empty.')

  const structured = original.match(/^(.+?):\s*((?:Season|Series)\s+\d+|Limited Series|Specials?|Season 0)(?:\s*:\s*.+)?$/i)
  if (!structured || !structured[1].trim()) return unchanged(original)

  return {
    searchTitle: structured[1].trim(),
    applied: true,
    transformation: `Removed explicit Netflix ${structured[2].toLowerCase()} structure`,
    reason: 'Netflix explicitly separates the parent series from its season, series, limited-series, special, or optional child title.',
    mediaTypeHint: 'series'
  }
}
