import { getTmdbReadAccessToken } from './tmdbCredentialStore.js'

const API_ROOT = 'https://api.themoviedb.org/3'

function requestError(status) {
  const error = new Error('TMDb discovery request failed.')
  error.status = status
  return error
}

function mediaTitle(result, mediaType) {
  return mediaType === 'movie' ? result.title : result.name
}

function mediaDate(result, mediaType) {
  return mediaType === 'movie' ? result.release_date : result.first_air_date
}

function year(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Number(date.slice(0, 4)) : null
}

export function normalizeTmdbDiscoveryCandidate(result, mediaType) {
  const title = mediaTitle(result, mediaType)
  const releaseDate = mediaDate(result, mediaType)
  if (!Number.isInteger(result?.id) || typeof title !== 'string' || !title.trim()) return null
  return {
    provider: 'tmdb', externalId: String(result.id), mediaType,
    canonicalTitle: title.trim(), releaseDate: releaseDate || null, releaseYear: year(releaseDate),
    overview: typeof result.overview === 'string' ? result.overview : null,
    genreIds: Array.isArray(result.genre_ids) ? result.genre_ids.filter(Number.isInteger) : [],
    genres: [], voteAverage: Number.isFinite(result.vote_average) ? result.vote_average : null,
    voteCount: Number.isInteger(result.vote_count) ? result.vote_count : null,
    popularity: Number.isFinite(result.popularity) ? result.popularity : null,
    posterPath: typeof result.poster_path === 'string' ? result.poster_path : null
  }
}

async function request(path, { getToken, fetchImpl }) {
  const token = await getToken()
  if (!token) throw requestError(null)
  let response
  try {
    response = await fetchImpl(`${API_ROOT}${path}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
    })
  } catch {
    throw requestError(null)
  }
  if (!response.ok) throw requestError(response.status)
  return response.json()
}

function queryPath(path, parameters) {
  const query = new URLSearchParams(parameters)
  return `${path}?${query.toString()}`
}

export async function fetchTmdbWatchProviders({ mediaType, region = 'US', getToken = getTmdbReadAccessToken, fetchImpl = globalThis.fetch }) {
  const type = mediaType === 'movie' ? 'movie' : 'tv'
  const payload = await request(queryPath(`/watch/providers/${type}`, { watch_region: region }), { getToken, fetchImpl })
  return (Array.isArray(payload?.results) ? payload.results : [])
    .filter(provider => Number.isInteger(provider?.provider_id) && typeof provider?.provider_name === 'string')
    .map(provider => ({ id: String(provider.provider_id), name: provider.provider_name, logoPath: typeof provider.logo_path === 'string' ? provider.logo_path : null }))
}

export async function fetchTmdbProviderDiscovery({ mediaType, providerIds, region = 'US', page = 1, getToken = getTmdbReadAccessToken, fetchImpl = globalThis.fetch }) {
  const type = mediaType === 'movie' ? 'movie' : 'tv'
  const ids = [...new Set((providerIds || []).map(String).filter(Boolean))]
  if (!ids.length) return []
  const payload = await request(queryPath(`/discover/${type}`, {
    language: 'en-US', page: String(Math.max(1, page)), watch_region: region,
    with_watch_providers: ids.join('|'), with_watch_monetization_types: 'flatrate|free|ads', sort_by: 'popularity.desc'
  }), { getToken, fetchImpl })
  return (Array.isArray(payload?.results) ? payload.results : []).map(result => normalizeTmdbDiscoveryCandidate(result, type)).filter(Boolean)
}

const COHORT_FILTERS = new Set([
  'sort_by', 'with_genres', 'without_genres', 'with_origin_country', 'with_original_language',
  'vote_average.gte', 'vote_count.gte', 'vote_count.lte', 'first_air_date.gte', 'first_air_date.lte',
  'primary_release_date.gte', 'primary_release_date.lte'
])

export async function fetchTmdbCohortDiscovery({ cohort, providerIds, region = 'US', page = 1, getToken = getTmdbReadAccessToken, fetchImpl = globalThis.fetch }) {
  const type = cohort?.mediaType === 'movie' ? 'movie' : 'tv'
  const ids = [...new Set((providerIds || []).map(String).filter(Boolean))]
  if (!ids.length) return []
  const filters = Object.fromEntries(Object.entries(cohort?.filters || {}).filter(([key, value]) => COHORT_FILTERS.has(key) && value !== null && value !== undefined && value !== ''))
  const payload = await request(queryPath(`/discover/${type}`, {
    language: 'en-US', page: String(Math.max(1, page)), include_adult: 'false',
    watch_region: region, with_watch_providers: ids.join('|'),
    with_watch_monetization_types: 'flatrate|free|ads', ...filters
  }), { getToken, fetchImpl })
  return (Array.isArray(payload?.results) ? payload.results : []).map(result => normalizeTmdbDiscoveryCandidate(result, type)).filter(Boolean)
}

export async function fetchTmdbWorkRecommendations({ seed, getToken = getTmdbReadAccessToken, fetchImpl = globalThis.fetch }) {
  const mediaType = seed.mediaType === 'movie' ? 'movie' : 'tv'
  const payload = await request(`/${mediaType}/${encodeURIComponent(seed.externalId)}/recommendations?language=en-US&page=1`, { getToken, fetchImpl })
  return (Array.isArray(payload?.results) ? payload.results : []).map(result => normalizeTmdbDiscoveryCandidate(result, mediaType)).filter(Boolean)
}

export async function fetchTmdbDiscoveryDetails({ candidate, getToken = getTmdbReadAccessToken, fetchImpl = globalThis.fetch }) {
  const mediaType = candidate.mediaType === 'movie' ? 'movie' : 'tv'
  const payload = await request(`/${mediaType}/${encodeURIComponent(candidate.externalId)}?language=en-US`, { getToken, fetchImpl })
  return {
    ...candidate,
    canonicalTitle: mediaTitle(payload, mediaType) || candidate.canonicalTitle,
    releaseDate: mediaDate(payload, mediaType) || candidate.releaseDate,
    releaseYear: year(mediaDate(payload, mediaType)) || candidate.releaseYear,
    overview: typeof payload.overview === 'string' ? payload.overview : candidate.overview,
    genreIds: Array.isArray(payload.genres) ? payload.genres.map(genre => genre.id).filter(Number.isInteger) : candidate.genreIds,
    genres: Array.isArray(payload.genres) ? payload.genres.filter(genre => Number.isInteger(genre?.id) && typeof genre?.name === 'string').map(genre => ({ id: genre.id, name: genre.name })) : candidate.genres,
    voteAverage: Number.isFinite(payload.vote_average) ? payload.vote_average : candidate.voteAverage,
    voteCount: Number.isInteger(payload.vote_count) ? payload.vote_count : candidate.voteCount,
    popularity: Number.isFinite(payload.popularity) ? payload.popularity : candidate.popularity,
    posterPath: typeof payload.poster_path === 'string' ? payload.poster_path : candidate.posterPath
  }
}
