import assert from 'node:assert/strict'
import { normalizeTmdbCandidate, searchTmdbCandidates } from '../src/data/tmdbClient.js'

const movie = normalizeTmdbCandidate({
  id: 101,
  title: 'Synthetic Movie',
  release_date: '2024-03-01',
  overview: 'This provider payload must not be retained.'
}, 'movie')
assert.deepEqual(movie, {
  provider: 'tmdb',
  externalId: '101',
  mediaType: 'movie',
  canonicalTitle: 'Synthetic Movie',
  releaseDate: '2024-03-01',
  releaseYear: 2024,
  externalIds: { tmdb: '101' }
})
assert.equal('overview' in movie, false)
assert.equal(normalizeTmdbCandidate({ id: 'bad', title: 'Ignored' }, 'movie'), null)

const requests = []
const candidates = await searchTmdbCandidates({
  query: 'Synthetic Title',
  mediaTypes: ['movie', 'series'],
  getToken: async () => 'synthetic-token',
  fetchImpl: async (url, options) => {
    requests.push({ url, options })
    return {
      ok: true,
      json: async () => ({ results: url.includes('/movie')
        ? [{ id: 201, title: 'Synthetic Title', release_date: '2020-01-01', overview: 'Discarded.' }]
        : [{ id: 202, name: 'Synthetic Title', first_air_date: '2021-02-02', overview: 'Discarded.' }]
      })
    }
  }
})
assert.equal(requests.length, 2)
assert.equal(requests[0].options.headers.Authorization, 'Bearer synthetic-token')
assert.equal(requests[0].options.cache, 'no-store')
assert.deepEqual(candidates.map(candidate => candidate.externalId), ['201', '202'])
assert.equal(JSON.stringify(candidates).includes('Discarded.'), false)

console.log('TMDb client checks passed.')
