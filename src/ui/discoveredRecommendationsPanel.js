import { runTmdbDiscovery } from '../data/tmdbDiscovery.js'
import { PRIVATE_STORES, commitCandidateEvidenceImport, listPrivateRecords } from '../data/privateStore.js'
import { previewCandidateEvidenceImport } from '../data/candidateEnrichment.js'

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])) }
function scoreFor(item, viewerId) { return item.viewerScores.find(score => score.viewerId === viewerId) }
function list(records, target) {
  return records.slice(0, 10).map(item => {
    const score = target === 'joint' ? item.joint.value : scoreFor(item, target).score
    const confidence = target === 'joint' ? `Viewer 1 ${scoreFor(item, 'viewer-1').score}% · Viewer 2 ${scoreFor(item, 'viewer-2').score}%` : `confidence ${Math.round(scoreFor(item, target).confidence * 100)}%`
    const explanation = target === 'joint' ? item.joint.explanation : scoreFor(item, target).reasons[0]
    const seeds = item.discoverySeeds.map(seed => seed.canonicalTitle).join(', ')
    return `<li><strong>${escapeHtml(item.canonicalTitle)}</strong><span>${item.releaseYear || 'Year unknown'} · ${escapeHtml(item.mediaType)} · <b>${score}%</b> · ${escapeHtml(confidence)}<br>${escapeHtml(explanation)}<br>TMDb discovery anchors: ${escapeHtml(seeds)}</span></li>`
  }).join('') || '<li>No eligible transient candidates.</li>'
}

export function createDiscoveredRecommendationsPanel({ requestRender }) {
  let state = { status: 'ready', result: null, progress: null, error: null, evidence: [], preview: null, success: null }
  let evidenceLoaded = false
  async function refreshEvidence() {
    try { state = { ...state, evidence: await listPrivateRecords(PRIVATE_STORES.candidateEvidence) } }
    catch { state = { ...state, error: 'Private candidate evidence is unavailable in this browser.' } }
  }
  async function run() {
    state = { ...state, status: 'running', error: null, progress: { stage: 'discovering', processed: 0, total: 0 } }
    requestRender()
    try { state = { ...state, status: 'ready', result: await runTmdbDiscovery({ onProgress: progress => { state = { ...state, progress }; requestRender() } }), progress: null } }
    catch { state = { ...state, status: 'ready', error: 'Discovery could not complete. No private history, preference, or identity data was changed.', progress: null } }
    requestRender()
  }
  async function previewFile(file) {
    if (!file) return
    try { state = { ...state, preview: previewCandidateEvidenceImport(await file.text(), { evidence: state.evidence, fileName: file.name }), error: null, success: null } }
    catch { state = { ...state, preview: null, error: 'The selected file is not a valid candidate-enrichment import.' } }
    requestRender()
  }
  async function commitPreview() {
    if (!state.preview?.records.length) return
    try {
      const result = await commitCandidateEvidenceImport(state.preview.records)
      await refreshEvidence()
      state = { ...state, preview: null, result: null, success: `Imported ${result.imported} private candidate-evidence record(s); ${result.skipped} duplicate(s) skipped. Run discovery again to rescore its transient pool.` }
    } catch { state = { ...state, error: 'The candidate-evidence import could not be completed.' } }
    requestRender()
  }
  function render(storeReady) {
    const result = state.result
    return `<section class="import-section" aria-labelledby="discovered-recommendations-heading"><div class="section-heading"><h2 id="discovered-recommendations-heading">Discovered Recommendations</h2><p>Transient browser-local TMDb candidates from confirmed positive anchors. These are not explicit preferences and are never saved automatically.</p></div><div class="import-panel"><button class="action-button" id="run-tmdb-discovery" ${storeReady && state.status !== 'running' ? '' : 'disabled'}>${state.status === 'running' ? `${state.progress?.stage === 'enriching' ? 'Enriching' : 'Discovering'} ${state.progress?.processed || 0} of ${state.progress?.total || '…'}…` : 'Discover recommendations from confirmed anchors'}</button>${state.error ? `<p class="import-error">${escapeHtml(state.error)}</p>` : ''}${state.success ? `<p class="import-success">${escapeHtml(state.success)}</p>` : ''}${result ? `<p><strong>${result.seeds.length}</strong> confirmed positive seeds · <strong>${result.candidates.length}</strong> transient unique candidates · Viewer 1 ${result.candidateCounts['viewer-1']} · Viewer 2 ${result.candidateCounts['viewer-2']} · joint ${result.candidateCounts.joint}.</p>${result.haltedReason ? `<p class="import-error">${escapeHtml(result.haltedReason)}</p>` : ''}${result.errors.length && !result.haltedReason ? `<p class="import-error">${escapeHtml(result.errors[0].message)} ${result.errors.length} TMDb request${result.errors.length === 1 ? '' : 's'} could not complete; successful transient results remain available for this review.</p>` : ''}<div class="analysis-columns"><div><h3>Viewer 1</h3><ul class="analysis-list">${list(result.viewerOne, 'viewer-1')}</ul></div><div><h3>Viewer 2</h3><ul class="analysis-list">${list(result.viewerTwo, 'viewer-2')}</ul></div><div><h3>For both viewers</h3><ul class="analysis-list">${list(result.joint, 'joint')}</ul></div></div>` : '<p>Uses at most 12 confirmed positive anchors, keeps at most 40 deduplicated candidates, and enriches at most 25. Running again replaces only this transient in-memory review.</p>'}<div class="import-preview"><h3>Import curated candidate evidence</h3><p>Local-only JSON. Each attribute must state its observed direction, value, confidence, scoring mechanisms, and concise rationale. Evidence is append-only; a later record supersedes prior evidence for the same TMDb work.</p><input id="candidate-evidence-file" type="file" accept="application/json,.json" ${storeReady ? '' : 'disabled'} />${state.preview ? `<p>${state.preview.summary.sourceRecords} source records; ${state.preview.summary.importable} safe to import; ${state.preview.summary.duplicates} duplicates skipped.</p>${state.preview.previewRecords.slice(0, 20).map(record => `<p>${escapeHtml(record.target.canonicalTitle || `TMDb ${record.target.externalId}`)}: <strong>${escapeHtml(record.status)}</strong></p>`).join('')}${state.preview.summary.problems.length ? `<p class="import-error">${escapeHtml(state.preview.summary.problems.join(' '))}</p>` : ''}<button class="action-button" id="confirm-candidate-evidence-import" ${state.preview.records.length ? '' : 'disabled'}>Import candidate evidence</button>` : ''}</div></div></section>`
  }
  function bind(storeReady) {
    if (!storeReady) return
    if (!evidenceLoaded) {
      evidenceLoaded = true
      refreshEvidence().then(requestRender)
    }
    document.querySelector('#run-tmdb-discovery')?.addEventListener('click', run)
    document.querySelector('#candidate-evidence-file')?.addEventListener('change', event => previewFile(event.target.files?.[0]))
    document.querySelector('#confirm-candidate-evidence-import')?.addEventListener('click', commitPreview)
  }
  return { render, bind }
}
