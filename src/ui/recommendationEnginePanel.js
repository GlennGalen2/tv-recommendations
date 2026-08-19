import { getPrivateRecommendationAnalysis } from '../data/privateStore.js'

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]) }
function scoreFor(item, viewerId) { return item.viewerScores.find(score => score.viewerId === viewerId) }
function recommendationList(records, kind) {
  return records.slice(0, 8).map(record => {
    const one = scoreFor(record, 'viewer-1')
    const two = scoreFor(record, 'viewer-2')
    const score = kind === 'joint' ? record.joint.value : scoreFor(record, kind).score
    const detail = kind === 'joint' ? `Viewer 1 ${one.score}% · Viewer 2 ${two.score}% · disagreement ${record.joint.disagreement}` : `confidence ${Math.round(scoreFor(record, kind).confidence * 100)}%`
    const explanation = kind === 'joint' ? record.explanation : scoreFor(record, kind).reasons
    return `<li><strong>${escapeHtml(record.title)}</strong><span><b>${score}%</b> · ${escapeHtml(detail)}<br>${escapeHtml(explanation.join(' '))}</span></li>`
  }).join('') || '<li>No eligible unwatched titles yet.</li>'
}

export function createRecommendationEnginePanel({ requestRender }) {
  let state = { status: 'loading', analysis: null }
  async function refresh() {
    state = { ...state, status: 'loading' }; requestRender()
    try { state = { ...state, status: 'ready', analysis: await getPrivateRecommendationAnalysis() } }
    catch { state = { ...state, status: 'error', analysis: null } }
    requestRender()
  }
  function render(storeReady) {
    const analysis = state.analysis
    return `<section class="import-section" aria-labelledby="recommendation-engine-heading"><div class="section-heading"><h2 id="recommendation-engine-heading">Private Recommendation Engine v1</h2><p>Derived locally from explicit reactions, probabilistic behavioral evidence, and any available title mechanisms. Known/rated and watched works train the scorer but are excluded from new recommendations.</p></div><div class="import-panel"><button class="action-button" id="refresh-recommendation-engine" ${storeReady && state.status !== 'loading' ? '' : 'disabled'}>Refresh recommendations</button>${state.status === 'loading' ? '<p>Scoring private titles locally…</p>' : ''}${state.status === 'error' ? '<p class="import-error">Private recommendations are unavailable in this browser.</p>' : ''}${analysis ? `<p>${analysis.candidateCounts['viewer-1']} Viewer 1 candidates · ${analysis.candidateCounts['viewer-2']} Viewer 2 candidates · ${analysis.candidateCounts.joint} joint candidates. Excluded as explicit anchors: Viewer 1 ${analysis.explicitAnchorExclusions['viewer-1']} · Viewer 2 ${analysis.explicitAnchorExclusions['viewer-2']} · joint ${analysis.explicitAnchorExclusions.joint}.</p><div class="analysis-columns"><div><h3>Viewer 1</h3><ul class="analysis-list">${recommendationList(analysis.viewerOne, 'viewer-1')}</ul></div><div><h3>Viewer 2</h3><ul class="analysis-list">${recommendationList(analysis.viewerTwo, 'viewer-2')}</ul></div><div><h3>For both viewers</h3><ul class="analysis-list">${recommendationList(analysis.joint, 'joint')}</ul></div></div>` : ''}</div></section>`
  }
  function bind(storeReady) {
    if (!storeReady) return
    document.querySelector('#refresh-recommendation-engine')?.addEventListener('click', refresh)
  }
  return { refresh, render, bind }
}
