import {
  clearTmdbReadAccessToken,
  getTmdbCredentialStatus,
  saveTmdbReadAccessToken
} from '../data/tmdbCredentialStore.js'

export function createTmdbCredentialPanel({ requestRender }) {
  let state = { status: 'loading', configured: false, error: null, success: null }

  async function refresh() {
    state = { ...state, status: 'loading', error: null }
    requestRender()
    try {
      const credential = await getTmdbCredentialStatus()
      state = { status: 'ready', configured: credential.configured, error: null, success: null }
    } catch {
      state = { status: 'error', configured: false, error: 'Private TMDb credential storage is unavailable in this browser.', success: null }
    }
    requestRender()
  }

  async function save() {
    const input = document.querySelector('#tmdb-read-access-token')
    try {
      await saveTmdbReadAccessToken(input?.value || '')
      if (input) input.value = ''
      state = { status: 'ready', configured: true, error: null, success: 'TMDb read token stored locally on this device.' }
    } catch {
      state = { ...state, status: 'ready', error: 'Enter a TMDb API Read Access Token to save it locally.', success: null }
    }
    requestRender()
  }

  async function clear() {
    try {
      await clearTmdbReadAccessToken()
      state = { status: 'ready', configured: false, error: null, success: 'TMDb read token removed from this device.' }
    } catch {
      state = { ...state, status: 'ready', error: 'The local TMDb read token could not be removed.', success: null }
    }
    requestRender()
  }

  function render(storeReady) {
    return `
      <section class="import-section" aria-labelledby="tmdb-credential-heading">
        <div class="section-heading">
          <h2 id="tmdb-credential-heading">TMDb private settings</h2>
          <p>Stored only in this browser’s separate credential store. No TMDb requests are made yet.</p>
        </div>
        <div class="import-panel">
          ${state.status === 'loading' ? '<p>Checking local TMDb credential storage…</p>' : ''}
          ${state.error ? `<p class="import-error">${state.error}</p>` : ''}
          ${state.success ? `<p class="import-success">${state.success}</p>` : ''}
          <p>${state.configured ? 'A TMDb read token is configured on this device. It is never displayed, exported, or included in private-data backups.' : 'No TMDb read token is configured on this device.'}</p>
          <label for="tmdb-read-access-token">TMDb API Read Access Token
            <input id="tmdb-read-access-token" type="password" autocomplete="off" spellcheck="false" ${storeReady && state.status !== 'loading' ? '' : 'disabled'}>
          </label>
          <div class="actions">
            <button class="action-button" id="save-tmdb-read-access-token" ${storeReady && state.status !== 'loading' ? '' : 'disabled'}>Save local token</button>
            <button class="action-button" id="clear-tmdb-read-access-token" ${storeReady && state.configured && state.status !== 'loading' ? '' : 'disabled'}>Remove local token</button>
          </div>
        </div>
      </section>
    `
  }

  function bind(storeReady) {
    if (!storeReady) return
    document.querySelector('#save-tmdb-read-access-token')?.addEventListener('click', save)
    document.querySelector('#clear-tmdb-read-access-token')?.addEventListener('click', clear)
  }

  return { bind, render, refresh }
}
