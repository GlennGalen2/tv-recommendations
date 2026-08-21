import { LONG_TAIL_DISCOVERY_COHORTS, runTmdbQualityCohortDiscoveryFromPrivateStore } from '../data/tmdbDiscovery.js'
import { PRIVATE_STORES, listPrivateRecords, readPrivateMetadata, writePrivateMetadata } from '../data/privateStore.js'
import { createLlmCandidateBatch } from '../data/llmEvaluationBatch.js'

const RUNNER_URL = 'http://127.0.0.1:5119'
const STATUS_KEY = 'recommendation-home-status-v1'
const HOME_LIMIT = 50
const HOME_CAP_CENTS = 150

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&gt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])) }
function targetKey(target) { return `${target.provider || 'tmdb'}:${target.mediaType}:${target.externalId}` }
function dateLabel(value) { return value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : 'Date unavailable' }
function recommendationScore(item) { return item.evaluation?.joint?.fitScore ?? 0 }
function recommendationConfidence(item) { return Math.round((item.evaluation?.joint?.confidence || 0) * 100) }
function freshCandidates(result, known) { return result.joint.filter(candidate => !known.has(`tmdb:${candidate.mediaType}:${candidate.externalId}`)) }

function importedRecommendations(records) {
  return records
    .filter(record => record.kind === 'llm-evaluation-batch')
    .flatMap(record => (record.llmEvaluationBatch?.evaluations || []).map(entry => ({
      id: targetKey(entry.target),
      batchId: record.llmEvaluationBatch.id,
      completedAt: record.llmEvaluationBatch.generatedAt || record.importedAt,
      target: { provider: entry.target.provider, mediaType: entry.target.mediaType, externalId: entry.target.externalId, title: entry.target.canonicalTitle, year: entry.target.releaseYear },
      evaluation: entry.evaluation,
      evaluationModel: record.llmEvaluationBatch.model
    })))
}

function statusLabel(status) {
  return ({ saved: 'Saved', watched: 'Watched', declined: 'Not for us' }[status] || '')
}

function card(item, statuses) {
  const status = statuses[item.id]?.status
  const target = item.target
  const score = recommendationScore(item)
  const rationale = item.evaluation?.joint?.rationale || 'This title was evaluated against both viewers’ preferences.'
  return `<article class="recommendation-card">
    <div class="recommendation-card__top">
      <div><p class="eyebrow">${escapeHtml(target.mediaType === 'tv' ? 'Series' : 'Movie')} · ${escapeHtml(target.year || 'Year unknown')}</p><h3>${escapeHtml(target.title)}</h3></div>
      <div class="match"><strong>${score}%</strong><span>for both</span></div>
    </div>
    <p class="recommendation-rationale">${escapeHtml(rationale)}</p>
    <p class="recommendation-meta">Confidence ${recommendationConfidence(item)}% · researched ${escapeHtml(dateLabel(item.completedAt))}${status ? ` · <strong>${escapeHtml(statusLabel(status))}</strong>` : ''}</p>
    <div class="actions"><button class="action-button ${status === 'saved' ? 'active' : ''}" data-home-action="saved" data-home-id="${escapeHtml(item.id)}">${status === 'saved' ? '✓ Saved' : 'Save'}</button><button class="action-button ${status === 'watched' ? 'active' : ''}" data-home-action="watched" data-home-id="${escapeHtml(item.id)}">${status === 'watched' ? '✓ Watched' : 'Watched'}</button><button class="action-button ${status === 'declined' ? 'active' : ''}" data-home-action="declined" data-home-id="${escapeHtml(item.id)}">${status === 'declined' ? '✓ Not for us' : 'Not for us'}</button></div>
  </article>`
}

export function createRecommendationHomePanel({ requestRender }) {
  let state = { tab: 'latest', status: 'loading', runner: null, records: [], statuses: {}, message: null, error: null, localRun: null }
  let initialized = false
  let pollTimer = null

  async function refresh() {
    const [records, storedStatuses] = await Promise.all([
      listPrivateRecords(PRIVATE_STORES.recommendations),
      readPrivateMetadata(STATUS_KEY)
    ])
    let runner = null
    try {
      const [statusResponse, recommendationsResponse] = await Promise.all([fetch(`${RUNNER_URL}/api/status`), fetch(`${RUNNER_URL}/api/recommendations`)])
      if (!statusResponse.ok || !recommendationsResponse.ok) throw new Error('Local runner was unavailable.')
      runner = { ...(await statusResponse.json()), recommendations: (await recommendationsResponse.json()).recommendations }
    } catch {
      runner = null
    }
    state = { ...state, status: 'ready', records, statuses: storedStatuses?.value || {}, runner }
    if (runner?.running || !runner) schedulePoll()
  }

  function schedulePoll() {
    if (pollTimer) return
    pollTimer = setTimeout(async () => {
      pollTimer = null
      try { await refresh() } catch { /* The home view stays usable if private storage is temporarily unavailable. */ }
      requestRender()
    }, 5000)
  }

  function allRecommendations() {
    const newest = new Map()
    for (const item of [...importedRecommendations(state.records), ...(state.runner?.recommendations || [])]) {
      const current = newest.get(item.id)
      if (!current || String(item.completedAt).localeCompare(String(current.completedAt)) > 0) newest.set(item.id, item)
    }
    return [...newest.values()].sort((left, right) => recommendationScore(right) - recommendationScore(left) || String(right.completedAt).localeCompare(String(left.completedAt)))
  }

  async function setStatus(id, status) {
    const current = state.statuses[id]?.status
    const statuses = { ...state.statuses, [id]: current === status ? {} : { status, changedAt: new Date().toISOString() } }
    await writePrivateMetadata({ key: STATUS_KEY, value: statuses })
    state = { ...state, statuses }
    requestRender()
  }

  async function startRun() {
    state = { ...state, localRun: { stage: 'discovering' }, error: null, message: 'Finding fresh possibilities from your saved viewing history and preferred services…' }
    requestRender()
    try {
      const known = new Set(allRecommendations().map(item => item.id))
      const updateProgress = progress => { state = { ...state, localRun: { stage: 'discovering', progress } }; requestRender() }
      const discovery = await runTmdbQualityCohortDiscoveryFromPrivateStore({ onProgress: updateProgress })
      let fresh = freshCandidates(discovery, known)
      if (fresh.length < HOME_LIMIT) {
        state = { ...state, message: `The usual discovery pool had only ${fresh.length} new title${fresh.length === 1 ? '' : 's'}. Looking farther into lower-exposure catalog pages…` }
        requestRender()
        const longTail = await runTmdbQualityCohortDiscoveryFromPrivateStore({
          cohorts: LONG_TAIL_DISCOVERY_COHORTS,
          pageNumbers: [3, 4, 5, 6],
          onProgress: updateProgress
        })
        const freshKeys = new Set(fresh.map(candidate => `tmdb:${candidate.mediaType}:${candidate.externalId}`))
        fresh = [...fresh, ...freshCandidates(longTail, known).filter(candidate => !freshKeys.has(`tmdb:${candidate.mediaType}:${candidate.externalId}`))]
      }
      if (!fresh.length) throw new Error('No new title was found after searching the wider catalog. Try again later or add a preferred service in Settings.')
      const candidateBatch = createLlmCandidateBatch(fresh, { limit: HOME_LIMIT })
      state = { ...state, localRun: { stage: 'starting', count: candidateBatch.candidates.length }, message: `Starting private research for ${candidateBatch.candidates.length} new titles…` }
      requestRender()
      const response = await fetch(`${RUNNER_URL}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateBatch, maxCostCents: HOME_CAP_CENTS }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'The local runner did not accept the request.')
      state = { ...state, localRun: null, message: `Research is running for ${result.items} new titles. The local queue reservation is $${(result.maxCostCents / 100).toFixed(2)}. You can close this browser and return later.`, error: null }
      await refresh()
      schedulePoll()
    } catch (error) {
      state = { ...state, localRun: null, error: error?.message || 'The recommendation run could not start.', message: null }
    }
    requestRender()
  }

  function render(storeReady) {
    if (!initialized && storeReady) {
      initialized = true
      void refresh().then(requestRender).catch(() => {})
    }
    const all = allRecommendations()
    const latestBatch = state.runner?.recommendations?.[0]?.batchId || all[0]?.batchId
    const visible = state.tab === 'latest' ? all.filter(item => item.batchId === latestBatch) : all
    const running = Boolean(state.runner?.running || state.localRun)
    const completedInActiveRun = state.runner?.running
      ? (state.runner.recommendations || []).filter(item => item.batchId === state.runner.run?.id).length
      : 0
    const activeRunProgress = state.runner?.running
      ? `<p class="run-progress" role="status">Researching: <strong>${completedInActiveRun} of ${state.runner.run?.total || 0}</strong> titles completed. Results appear here automatically.</p>`
      : ''
    const progress = state.localRun?.progress
    const runnerMessage = state.runner?.running
      ? `Your local runner is working on ${state.runner.run?.total || 'the'} title batch. This page refreshes automatically.`
      : state.runner
        ? 'Local runner connected. Your OpenAI key remains on this PC.'
        : 'Start the Windows-local runner before requesting more titles: npm run recommendation-runner'
    return `<section class="recommendation-home" aria-labelledby="recommendation-home-heading">
      <div class="home-intro"><div><p class="eyebrow">YOUR NEXT WATCH</p><h2 id="recommendation-home-heading">Recommendations for both of you</h2><p>Private viewing history guides discovery; each fresh title is researched and then scored for both viewers.</p></div><p class="runner-status ${state.runner ? 'connected' : ''}">${escapeHtml(runnerMessage)}</p></div>
      <nav class="recommendation-tabs" aria-label="Recommendation views"><button class="tab-button ${state.tab === 'latest' ? 'active' : ''}" data-home-tab="latest">Latest ${latestBatch ? `(${all.filter(item => item.batchId === latestBatch).length})` : ''}</button><button class="tab-button ${state.tab === 'all' ? 'active' : ''}" data-home-tab="all">All recommendations (${all.length})</button><button class="tab-button ${state.tab === 'more' ? 'active' : ''}" data-home-tab="more">Get more</button></nav>
      ${activeRunProgress}${state.message ? `<p class="import-success">${escapeHtml(state.message)}</p>` : ''}${state.error ? `<p class="import-error">${escapeHtml(state.error)}</p>` : ''}
      ${state.tab === 'more' ? `<section class="get-more-panel"><h3>Research 50 new possibilities</h3><p>First, TMDb finds candidates from your history and preferred services. Then your local runner sends public title information to Nano for web research and your private preference profile plus those research notes to Mini for scoring.</p><p><strong>Queue reservation: $1.50.</strong> It prevents the next title from starting once the reservation is used; actual API billing varies, so the OpenAI dashboard remains authoritative.</p><button class="action-button primary-action" id="start-local-recommendation-run" ${storeReady && state.runner && !running ? '' : 'disabled'}>${state.localRun?.stage === 'discovering' ? `Finding candidates${progress?.processed ? ` (${progress.processed}/${progress.total})` : ''}…` : state.localRun?.stage === 'starting' ? 'Starting local runner…' : state.runner?.running ? 'Research is running…' : state.runner ? 'Research up to 50 new titles' : 'Start the local runner first'}</button><p class="quiet-note">Choosing this button authorizes this one OpenAI research run. No key is stored in the browser.</p></section>` : `<section class="recommendation-list">${visible.length ? visible.map(item => card(item, state.statuses)).join('') : '<div class="empty-message">No completed recommendations yet. Choose “Get more” when the local runner is running.</div>'}</section>`}
    </section>`
  }

  function bind(storeReady) {
    document.querySelectorAll('[data-home-tab]').forEach(button => button.addEventListener('click', () => { state = { ...state, tab: button.dataset.homeTab }; requestRender() }))
    document.querySelectorAll('[data-home-action]').forEach(button => button.addEventListener('click', () => { void setStatus(button.dataset.homeId, button.dataset.homeAction) }))
    document.querySelector('#start-local-recommendation-run')?.addEventListener('click', () => { if (storeReady) void startRun() })
  }

  return { render, bind, refresh }
}
