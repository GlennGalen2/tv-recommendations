function unchanged(sourceTitle, reason = 'No safely separable Amazon structural wrapper was found.') {
  return { searchTitle: sourceTitle, applied: false, transformation: 'none', reason, mediaTypeHint: null }
}

function normalized(sourceTitle, searchTitle, transformation, reason, mediaTypeHint = null) {
  return { searchTitle, applied: true, transformation, reason, mediaTypeHint }
}

function usableTitle(value) {
  const title = String(value || '').replace(/\s+/g, ' ').trim()
  return title.length >= 2 && !/^(?:season|series|episode|ep\.?)(?:\s+\d+)?$/i.test(title) ? title : null
}

// Lookup-only: this never changes imported records, history, or resolutions.
export function normalizeAmazonLookupTitle(sourceTitle) {
  const original = String(sourceTitle || '').replace(/\s+/g, ' ').trim()
  if (!original) return unchanged(original, 'The Amazon source title is empty.')

  const seasonOrSeries = original.match(/^(.+?)(?:\s*[-–—,:]\s*|\s+)(Season|Series)\s+(\d+)\s*$/i)
  if (seasonOrSeries) {
    const title = usableTitle(seasonOrSeries[1])
    if (title) return normalized(original, title, `Removed explicit ${seasonOrSeries[2].toLowerCase()} ${seasonOrSeries[3]} suffix`, 'The source title ends with an explicit season or series number, which is a series wrapper rather than the canonical work title.', 'series')
  }

  const explicitEpisode = original.match(/^(.+?)(?:\s*[-–—,:]\s*)(?:Episode|Ep\.?)\s+(\d+)(?:\s*[:\-–—]\s*.+)?\s*$/i)
  if (explicitEpisode) {
    const title = usableTitle(explicitEpisode[1])
    if (title) return normalized(original, title, `Removed explicit episode ${explicitEpisode[2]} suffix`, 'The source title explicitly separates an episode label after a title, so the preceding text is used only as a series lookup title.', 'series')
  }

  const supplemental = original.match(/^(.+?)(?:\s*[-–—,:]\s*)(?:Episode\s+0\s*[:\-–—]\s*)?(?:Official\s+)?(Trailer|Recap|Preview)\b.*$/i)
  if (supplemental) {
    const title = usableTitle(supplemental[1])
    if (title && !/\b(?:season|series)\s+\d+\s*$/i.test(title)) return normalized(original, title, `Removed explicit ${supplemental[2].toLowerCase()} wrapper`, 'The source title explicitly marks trailing text as supplemental material while retaining a separate leading work title.')
  }

  if (/^Episode\s+0\s*:/i.test(original)) return unchanged(original, 'An episode-zero item has no separately identified parent title, so it cannot be safely reduced.')
  return unchanged(original)
}
