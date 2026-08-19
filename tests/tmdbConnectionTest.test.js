import assert from 'node:assert/strict'
import { testTmdbConnection } from '../src/data/tmdbConnectionTest.js'

let calls = 0
let options
const successful = await testTmdbConnection({
  getToken: async () => 'synthetic-read-token',
  fetchImpl: async (url, request) => {
    calls += 1
    options = { url, request }
    return { status: 200 }
  }
})
assert.deepEqual(successful, { ok: true, status: 200, message: 'TMDb connection succeeded.' })
assert.equal(calls, 1)
assert.equal(options.url, 'https://api.themoviedb.org/3/authentication')
assert.equal(options.request.headers.Authorization, 'Bearer synthetic-read-token')
assert.equal(options.request.cache, 'no-store')
assert.equal(options.request.credentials, 'omit')

let noTokenCalls = 0
assert.deepEqual(await testTmdbConnection({
  getToken: async () => null,
  fetchImpl: async () => { noTokenCalls += 1 }
}), { ok: false, status: null, message: 'No TMDb read token is configured on this device.' })
assert.equal(noTokenCalls, 0)

for (const [status, message] of [
  [401, 'TMDb rejected the configured read token.'],
  [403, 'TMDb denied access for the configured read token.'],
  [429, 'TMDb rate-limited this connection test. Try again later.']
]) {
  const result = await testTmdbConnection({
    getToken: async () => 'synthetic-read-token',
    fetchImpl: async () => ({ status })
  })
  assert.deepEqual(result, { ok: false, status, message })
}

assert.deepEqual(await testTmdbConnection({
  getToken: async () => 'synthetic-read-token',
  fetchImpl: async () => { throw new TypeError('Synthetic network failure') }
}), {
  ok: false,
  status: null,
  message: 'The browser could not complete the TMDb request (network or CORS restriction).'
})

console.log('TMDb connection-test checks passed.')
