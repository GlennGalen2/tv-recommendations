import {
  clearTmdbReadAccessToken,
  getTmdbCredentialStatus,
  saveTmdbReadAccessToken
} from '../data/tmdbCredentialStore.js'
import { testTmdbConnection } from '../data/tmdbConnectionTest.js'

export function createTmdbCredentialPanel({ requestRender }) {
  let state = { status: 'loading', configured: false, error: null, success: null, connection: null }

  async function refresh() {
    state = { ...state, status: 'loading', error: null }
    requestRender()
    try {
      const credential = await getTmdbCredentialStatus()
      state = { status: 'ready', configured: credential.configured, error: null, success: null, connection: null }
    } catch {
      state = { status: 'error', configured: false, error: 'Private TMDb credential storage is unavailable in this browser.', success: null, connection: null }
    }
    requestRender()
  }

  async function save() {
    const input = document.querySelector('#tmdb-read-access-token')
    try {
      await saveTmdbReadAccessToken(input?.value || '')
      if (input) input.value = ''
      state = { status: 'ready', configured: true, error: null, success: 'TMDb read token stored locally on this device.', connection: null }
    } catch {
      state = { ...state, status: 'ready', error: 'Enter a TMDb API Read Access Token to save it locally.', success: null, connection: null }
    }
    requestRender()
  }

  async function clear() {
    try {
      await clearTmdbReadAccessToken()
      state = { status: 'ready', configured: false, error: null, success: 'TMDb read token removed from this device.', connection: null }
    } catch {
      state = { ...state, status: 'ready', error: 'The local TMDb read token could not be removed.', success: null, connection: null }
    }
    requestRender()
  }

  async function testConnection() {
    state = { ...state, status: 'testing', error: null, success: null, connection: null }
    requestRender()
    const result = await testTmdbConnection()
    state = { ...state, status: 'ready', connection: result }
    requestRender()
  }

  function render(storeReady) {
    return `
      <section class="import-section" aria-labelledby="tmdb-credential-heading">
        <div class="section-heading">
          <h2 id="tmdb-credential-heading">TMDb private settings</h2>
          <p>Stored only in this browser’s separate credential store. This panel can test authentication but does not query private titles.</p>
        </div>
        <div class="import-panel">
          ${state.status === 'loading' ? '<p>Checking local TMDb credential storage…</p>' : ''}
          ${state.error ? `<p class="import-error">${state.error}</p>` : ''}
          ${state.success ? `<p class="import-success">${state.success}</p>` : ''}
          ${state.connection ? `<p class="${state.connection.ok ? 'import-success' : 'import-error'}">${state.connection.message}${state.connection.status ? ` HTTP ${state.connection.status}.` : ''}</p>` : ''}
          <p>${state.configured ? 'A TMDb read token is configured on this device. It is never displayed, exported, or included in private-data backups.' : 'No TMDb read token is configured on this device.'}</p>
          <label for="tmdb-read-access-token">TMDb API Read Access Token
            <input id="tmdb-read-access-token" type="password" autocomplete="off" spellcheck="false" ${storeReady && state.status !== 'loading' ? '' : 'disabled'}>
          </label>
          <div class="actions">
            <button class="action-button" id="save-tmdb-read-access-token" ${storeReady && state.status !== 'loading' ? '' : 'disabled'}>Save local token</button>
            <button class="action-button" id="clear-tmdb-read-access-token" ${storeReady && state.configured && state.status !== 'loading' ? '' : 'disabled'}>Remove local token</button>
            <button class="action-button" id="test-tmdb-connection" ${storeReady && state.configured && state.status !== 'loading' && state.status !== 'testing' ? '' : 'disabled'}>${state.status === 'testing' ? 'Testing TMDb connection…' : 'Test TMDb connection'}</button>
          </div>
        </div>
      </section>
    `
  }

  function bind(storeReady) {
    if (!storeReady) return
    document.querySelector('#save-tmdb-read-access-token')?.addEventListener('click', save)
    document.querySelector('#clear-tmdb-read-access-token')?.addEventListener('click', clear)
    document.querySelector('#test-tmdb-connection')?.addEventListener('click', testConnection)
  }

  return { bind, render, refresh }
}
