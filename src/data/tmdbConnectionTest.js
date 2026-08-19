import { getTmdbReadAccessToken } from './tmdbCredentialStore.js'

const TMDB_AUTHENTICATION_URL = 'https://api.themoviedb.org/3/authentication'

export async function testTmdbConnection({
  getToken = getTmdbReadAccessToken,
  fetchImpl = globalThis.fetch
} = {}) {
  try {
    const token = await getToken()
    if (!token) {
      return {
        ok: false,
        status: null,
        message: 'No TMDb read token is configured on this device.'
      }
    }
    const response = await fetchImpl(TMDB_AUTHENTICATION_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    })

    if (response.status >= 200 && response.status < 300) {
      return { ok: true, status: response.status, message: 'TMDb connection succeeded.' }
    }
    if (response.status === 401) {
      return { ok: false, status: 401, message: 'TMDb rejected the configured read token.' }
    }
    if (response.status === 403) {
      return { ok: false, status: 403, message: 'TMDb denied access for the configured read token.' }
    }
    if (response.status === 429) {
      return { ok: false, status: 429, message: 'TMDb rate-limited this connection test. Try again later.' }
    }
    return { ok: false, status: response.status, message: 'TMDb returned an unexpected response.' }
  } catch {
    return {
      ok: false,
      status: null,
      message: 'The browser could not complete the TMDb request (network or CORS restriction).'
    }
  }
}

export const TMDB_CONNECTION_TEST_ENDPOINT = TMDB_AUTHENTICATION_URL
