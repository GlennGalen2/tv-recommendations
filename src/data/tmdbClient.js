import { getTmdbReadAccessToken } from './tmdbCredentialStore.js'

const API_ROOT = 'https://api.themoviedb.org/3/search/'

function releaseYear(releaseDate) {
  return typeof releaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate)
    ? Number(releaseDate.slice(0, 4))
    : null
}

export function normalizeTmdbCandidate(result, mediaType) {
  const canonicalTitle = mediaType === 'movie' ? result.title : result.name
  const releaseDate = mediaType === 'movie' ? result.release_date : result.first_air_date

  if (!Number.isInteger(result.id) || typeof canonicalTitle !== 'string' || !canonicalTitle.trim()) {
    return null
  }

  return {
    provider: 'tmdb',
    externalId: String(result.id),
    mediaType,
    canonicalTitle: canonicalTitle.trim(),
    releaseDate: releaseDate || null,
    releaseYear: releaseYear(releaseDate),
    externalIds: { tmdb: String(result.id) }
  }
}

function requestError(status) {
  const error = new Error('TMDb search request failed.')
  error.status = status
  return error
}

export async function searchTmdbCandidates({
  query,
  mediaTypes,
  getToken = getTmdbReadAccessToken,
  fetchImpl = globalThis.fetch
}) {
  const token = await getToken()
  if (!token) throw requestError(null)

  const candidates = []
  for (const mediaType of mediaTypes) {
    const endpoint = mediaType === 'movie' ? 'movie' : 'tv'
    let response
    try {
      response = await fetchImpl(`${API_ROOT}${endpoint}?query=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      })
    } catch {
      throw requestError(null)
    }
    if (!response.ok) throw requestError(response.status)

    const payload = await response.json()
    for (const result of Array.isArray(payload?.results) ? payload.results : []) {
      const candidate = normalizeTmdbCandidate(result, mediaType)
      if (candidate) candidates.push(candidate)
    }
  }

  return candidates
}
