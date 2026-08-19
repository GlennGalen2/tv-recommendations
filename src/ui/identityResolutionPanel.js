import {
  createIdentityResolution,
  getPrivateIdentityResolutionReview,
  undoIdentityResolution
} from '../data/privateStore.js'
import { runTmdbMatchingPilot } from '../data/tmdbMatchingPilot.js'

const SYNTHETIC_SOURCE_TITLE_ID = 'synthetic:identity-resolution-demo'
const SYNTHETIC_CANDIDATE = {
  provider: 'synthetic-provider',
  externalId: 'synthetic-series-101',
  mediaType: 'series',
  canonicalTitle: 'Synthetic Orbit Station',
  releaseYear: 2024,
  series: { provider: 'synthetic-provider', externalId: 'synthetic-series-101', canonicalTitle: 'Synthetic Orbit Station' },
  confidence: 0.96,
  reasons: ['Synthetic provider result for UI review only.']
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character])
}

export function createIdentityResolutionPanel({ requestRender }) {
  let state = { status: 'loading', review: null, error: null }

  async function refresh() {
    state = { ...state, status: 'loading', error: null }
    requestRender()
    try {
      state = { status: 'ready', review: await getPrivateIdentityResolutionReview(), error: null }
    } catch {
      state = { status: 'error', review: null, error: 'Private identity-resolution data is unavailable in this browser.' }
    }
    requestRender()
  }

  async function recordSyntheticDecision(status) {
    try {
      await createIdentityResolution({
        id: `resolution_${crypto.randomUUID()}`,
        schemaVersion: 1,
        sourceTitleId: SYNTHETIC_SOURCE_TITLE_ID,
        status,
        candidate: SYNTHETIC_CANDIDATE,
        confidence: SYNTHETIC_CANDIDATE.confidence,
        resolutionMethod: status === 'manually-confirmed' ? 'manual-confirmation' : 'manual-rejection',
        rationale: SYNTHETIC_CANDIDATE.reasons,
        recordedAt: new Date().toISOString(),
        supersedesResolutionId: state.review?.syntheticDemo?.id || null
      })
      await refresh()
    } catch {
      state = { ...state, error: 'The synthetic review decision could not be saved.' }
      requestRender()
    }
  }

  async function undoSyntheticDecision() {
    try {
      await undoIdentityResolution(state.review?.syntheticDemo?.id)
      await refresh()
    } catch {
      state = { ...state, error: 'The synthetic review decision could not be undone.' }
      requestRender()
    }
  }

  async function runPilot() {
    state = { ...state, status: 'running-pilot', error: null, pilot: null }
    requestRender()
    try {
      const pilot = await runTmdbMatchingPilot()
      state = { ...state, status: 'ready', pilot }
    } catch {
      state = { ...state, status: 'ready', error: 'The TMDb pilot could not complete. No private data or resolutions were changed.', pilot: null }
    }
    requestRender()
  }

  function pilotItem(result) {
    const candidate = result.bestCandidate
    const stateLabel = {
      'strong-candidate': 'Strong candidate — review before confirming',
      'review-candidate': 'Review candidate',
      unresolved: 'Unresolved / no adequate candidate'
    }[result.state]
    const alternate = result.alternateCandidates.length
      ? `<span>Alternates: ${result.alternateCandidates.map(item => `${escapeHtml(item.canonicalTitle)} (${Math.round(item.score * 100)}%)`).join(', ')}</span>`
      : ''
    return `<li><strong>${escapeHtml(result.sourceTitle)}</strong>
      <span>${escapeHtml(result.sourceNames.join(', ') || 'Unknown source')} · existing ${escapeHtml(result.existingType)}</span>
      <span><strong>${escapeHtml(stateLabel)}</strong>${candidate ? ` · ${escapeHtml(candidate.canonicalTitle)} · ${escapeHtml(candidate.mediaType)}${candidate.releaseYear ? ` · ${candidate.releaseYear}` : ''} · ${Math.round(candidate.score * 100)}% · ${escapeHtml(candidate.reasons.join(' '))}` : ''}</span>
      ${alternate}${result.error ? `<span>${escapeHtml(result.error)}</span>` : ''}
    </li>`
  }

  function render(storeReady) {
    const counts = state.review?.counts
    const synthetic = state.review?.syntheticDemo
    const syntheticStatus = synthetic?.status || 'unresolved'
    const pilot = state.pilot

    return `
      <section class="import-section" aria-labelledby="identity-resolution-heading">
        <div class="section-heading">
          <h2 id="identity-resolution-heading">Metadata Enrichment &amp; Identity Resolution</h2>
          <p>Private resolution records never rewrite playback history. Provider lookups run only through the explicit 10-title pilot below.</p>
        </div>
        <div class="import-panel">
          <button class="action-button" id="refresh-identity-resolution" ${storeReady && state.status !== 'loading' ? '' : 'disabled'}>Refresh resolution status</button>
          ${state.status === 'loading' ? '<p>Reading private resolution state locally…</p>' : ''}
          ${state.error ? `<p class="import-error">${state.error}</p>` : ''}
          ${counts ? `<div class="analysis-grid">
            <p><strong>${counts.unresolved}</strong> unresolved</p>
            <p><strong>${counts.candidateMatch}</strong> candidate matches</p>
            <p><strong>${counts.confidentlyResolved}</strong> confidently resolved</p>
            <p><strong>${counts.manuallyConfirmed}</strong> manually confirmed</p>
            <p><strong>${counts.manuallyRejected}</strong> manually rejected</p>
          </div>` : ''}
          <div class="import-preview">
            <h3>10-title TMDb matching pilot</h3>
            <p>Runs locally against exactly ten selected private title records. Results remain in this panel only; no candidate or resolution is persisted or automatically accepted.</p>
            <button class="action-button" id="run-tmdb-matching-pilot" ${storeReady && state.status !== 'loading' && state.status !== 'running-pilot' ? '' : 'disabled'}>${state.status === 'running-pilot' ? 'Running 10-title pilot…' : 'Run 10-title TMDb pilot'}</button>
            ${pilot ? `<div class="analysis-grid">
              <p><strong>${pilot.distribution['strong-candidate']}</strong> strong candidates</p>
              <p><strong>${pilot.distribution['review-candidate']}</strong> review candidates</p>
              <p><strong>${pilot.distribution.unresolved}</strong> unresolved</p>
            </div>
            <ul class="analysis-list">${pilot.results.map(pilotItem).join('')}</ul>` : ''}
          </div>
          <div class="import-preview">
            <h3>Synthetic review exercise</h3>
            <p><strong>${escapeHtml(SYNTHETIC_CANDIDATE.canonicalTitle)}</strong> · ${escapeHtml(SYNTHETIC_CANDIDATE.mediaType)} · ${Math.round(SYNTHETIC_CANDIDATE.confidence * 100)}% confidence</p>
            <p>${escapeHtml(SYNTHETIC_CANDIDATE.reasons[0])} This is not based on any imported title and does not resolve or merge your history.</p>
            <p>Current synthetic decision: <strong>${escapeHtml(syntheticStatus)}</strong>.</p>
            ${syntheticStatus === 'unresolved' || syntheticStatus === 'candidate-match'
              ? '<button class="action-button" id="confirm-synthetic-resolution">Confirm synthetic candidate</button> <button class="action-button" id="reject-synthetic-resolution">Reject synthetic candidate</button>'
              : '<button class="action-button" id="undo-synthetic-resolution">Undo synthetic decision</button>'}
          </div>
        </div>
      </section>
    `
  }

  function bind(storeReady) {
    if (!storeReady) return
    document.querySelector('#refresh-identity-resolution')?.addEventListener('click', refresh)
    document.querySelector('#confirm-synthetic-resolution')?.addEventListener('click', () => recordSyntheticDecision('manually-confirmed'))
    document.querySelector('#reject-synthetic-resolution')?.addEventListener('click', () => recordSyntheticDecision('manually-rejected'))
    document.querySelector('#undo-synthetic-resolution')?.addEventListener('click', undoSyntheticDecision)
    document.querySelector('#run-tmdb-matching-pilot')?.addEventListener('click', runPilot)
  }

  return { bind, render, refresh }
}
