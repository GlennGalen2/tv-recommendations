import { LONG_TAIL_DISCOVERY_COHORTS, PRIVATE_DISCOVERY_AVAILABILITY_KEY, runTmdbDiscovery, runTmdbPreferredServiceDiscoveryFromPrivateStore, runTmdbQualityCohortDiscoveryFromPrivateStore } from '../data/tmdbDiscovery.js'
import { PRIVATE_STORES, commitCandidateEvidenceImport, commitLlmEvaluationBatch, listPrivateRecords, readPrivateMetadata, writePrivateMetadata } from '../data/privateStore.js'
import { previewCandidateEvidenceImport } from '../data/candidateEnrichment.js'
import { createLlmCandidateBatch, previewLlmEvaluationBatchImport, unevaluatedLlmCandidates } from '../data/llmEvaluationBatch.js'

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])) }
function scoreFor(item, viewerId) { return item.viewerScores.find(score => score.viewerId === viewerId) }
const TRACE_TITLES = new Set(['power book iv force', 'bosch legacy', 'murder in a small town', 'the terminal list', 'hidden assets'])
function traceTitleKey(value) { return String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() }
function number(value) { return Number(value || 0).toFixed(2) }
function viewerTrace(score) {
  const trace = score.trace
  if (!trace) return ''
  const matched = trace.candidateEvidence.matched.map(item => `<li>${escapeHtml(item.attribute)} (${escapeHtml(item.direction)}; ${escapeHtml(item.mechanismWeights.map(weight => `${weight.mechanism} ${number(weight.weight)}`).join(', '))}${item.mechanisms.join('|') !== item.sourceMechanisms.join('|') ? `; interpreted from ${escapeHtml(item.sourceMechanisms.join(', '))}` : ''}): ${number(item.contribution)} — ${escapeHtml(item.rationale)}</li>`).join('') || '<li>None</li>'
  const unmatched = trace.candidateEvidence.unmatchedAttributes.map(item => `<li>${escapeHtml(item.attribute)} (${escapeHtml(item.mechanisms.join(', '))}) — no learned viewer mechanism matched.</li>`).join('') || '<li>None</li>'
  const missing = trace.candidateEvidence.unmatchedViewerMechanisms.map(mechanism => `<li>${escapeHtml(mechanism)}</li>`).join('') || '<li>None</li>'
  return `<details><summary>${escapeHtml(score.viewerId === 'viewer-1' ? 'Viewer 1' : 'Viewer 2')}: ${score.score}% · confidence ${Math.round(score.confidence * 100)}%</summary><ul class="analysis-list"><li>Base: ${number(trace.baseScore)}</li><li>Explicit anchor: ${number(trace.explicitAnchorContribution)}</li><li>Behavioral: ${number(trace.behavioralContribution)}</li><li>Cross-viewer: ${number(trace.crossViewerContribution)}</li><li>Candidate metadata mechanisms: ${number(trace.titleMechanismContribution)}</li><li>Candidate evidence: ${number(trace.candidateEvidenceContribution)}</li><li>Negative-mechanism penalties: ${number(trace.negativeMechanismPenalty)}</li><li>Discovery support: ${number(trace.discoveryContribution)}</li><li>Engine total: ${number(trace.totalBeforeClamp)} → ${trace.engineScore}</li><li>Final: ${trace.engineScore} + ${number(trace.discoveryContribution)} = <strong>${trace.finalScore}</strong></li><li>Confidence: base ${Math.round(trace.confidenceBase * 100)}%; ${trace.confidenceSources.map(item => `${escapeHtml(item.source)} ${Math.round(item.value * 100)}%`).join('; ') || 'no additional evidence'}</li></ul><p><strong>Matched candidate evidence</strong></p><ul class="analysis-list">${matched}</ul><p><strong>Candidate evidence with zero learned-mechanism contribution</strong></p><ul class="analysis-list">${unmatched}</ul><p><strong>Learned viewer mechanisms absent from candidate evidence</strong></p><ul class="analysis-list">${missing}</ul></details>`
}
function scoreTrace(result) {
  const candidates = result.candidates.filter(candidate => TRACE_TITLES.has(traceTitleKey(candidate.canonicalTitle)))
  if (!candidates.length) return '<p>None of the configured diagnostic titles are in this transient discovery result.</p>'
  return candidates.map(candidate => `<article class="import-preview"><h4>${escapeHtml(candidate.canonicalTitle)} (${escapeHtml(candidate.mediaType)})</h4>${viewerTrace(scoreFor(candidate, 'viewer-1'))}${viewerTrace(scoreFor(candidate, 'viewer-2'))}<details><summary>Joint score: ${candidate.joint.value}%</summary><ul class="analysis-list"><li>Lower-viewer contribution: ${number(candidate.joint.trace.lowerViewerContribution)}</li><li>Average contribution: ${number(candidate.joint.trace.averageContribution)}</li><li>Disagreement penalty: -${number(candidate.joint.trace.disagreementPenalty)}</li><li>Final: ${number(candidate.joint.trace.totalBeforeClamp)} → <strong>${candidate.joint.trace.finalScore}</strong></li></ul></details></article>`).join('')
}
function list(records, target) {
  return records.slice(0, 10).map(item => {
    const score = target === 'joint' ? item.joint.value : scoreFor(item, target).score
    const confidence = target === 'joint' ? `Viewer 1 ${scoreFor(item, 'viewer-1').score}% · Viewer 2 ${scoreFor(item, 'viewer-2').score}%` : `confidence ${Math.round(scoreFor(item, target).confidence * 100)}%`
    const explanation = target === 'joint' ? item.joint.explanation : scoreFor(item, target).reasons[0]
    const seeds = item.discoverySeeds.map(seed => seed.canonicalTitle).join(', ')
    const sources = (item.discoverySources || []).map(source => source.providerName || source.cohortName).filter(Boolean).join(', ')
    const provenance = [seeds && `TMDb discovery anchors: ${seeds}`, sources && `Discovery neighborhoods: ${sources}`].filter(Boolean).join(' · ')
    const priority = Number.isInteger(item.discoveryPriority) ? `Research priority ${item.discoveryPriority} (not a fit score)` : ''
    return `<li><strong>${escapeHtml(item.canonicalTitle)}</strong><span>${item.releaseYear || 'Year unknown'} · ${escapeHtml(item.mediaType)} · <b>${score}%</b> · ${escapeHtml(confidence)}<br>${escapeHtml(explanation)}<br>${escapeHtml([provenance, priority].filter(Boolean).join(' · '))}</span></li>`
  }).join('') || '<li>No eligible transient candidates.</li>'
}
function llmRanking(records) {
  const latest = [...records].sort((left, right) => String(right.importedAt).localeCompare(String(left.importedAt)))[0]
  if (!latest) return ''
  const batch = latest.llmEvaluationBatch
  const ranked = [...batch.evaluations].sort((left, right) => right.evaluation.joint.fitScore - left.evaluation.joint.fitScore || left.target.canonicalTitle.localeCompare(right.target.canonicalTitle))
  return `<div class="import-preview"><h3>Latest private LLM review ranking</h3><p>${escapeHtml(batch.model)} · ${ranked.length} evaluated candidate${ranked.length === 1 ? '' : 's'} · predictions only, not preference evidence.</p><ol class="analysis-list">${ranked.map(entry => `<li><strong>${escapeHtml(entry.target.canonicalTitle)}</strong><span>${entry.target.releaseYear || 'Year unknown'} · ${escapeHtml(entry.target.mediaType)} · <b>Joint ${entry.evaluation.joint.fitScore}%</b> (confidence ${Math.round(entry.evaluation.joint.confidence * 100)}%)<br>Viewer 1 ${entry.evaluation.viewer1.fitScore}% · Viewer 2 ${entry.evaluation.viewer2.fitScore}%<br>${escapeHtml(entry.evaluation.joint.rationale)}</span></li>`).join('')}</ol></div>`
}

export function createDiscoveredRecommendationsPanel({ requestRender }) {
  let state = { status: 'ready', result: null, progress: null, error: null, evidence: [], preview: null, llmPreview: null, llmBatches: [], success: null, showTrace: false, availability: { region: 'US', serviceNames: [], priorityServiceNames: [] } }
  let evidenceLoaded = false
  async function refreshEvidence() {
    try {
      const [evidence, recommendations, availability] = await Promise.all([listPrivateRecords(PRIVATE_STORES.candidateEvidence), listPrivateRecords(PRIVATE_STORES.recommendations), readPrivateMetadata(PRIVATE_DISCOVERY_AVAILABILITY_KEY)])
      state = { ...state, evidence, llmBatches: recommendations.filter(record => record.kind === 'llm-evaluation-batch'), availability: availability?.value || state.availability }
    }
    catch { state = { ...state, error: 'Private candidate evidence is unavailable in this browser.' } }
  }
  async function run() {
    state = { ...state, status: 'running', error: null, progress: { stage: 'discovering', processed: 0, total: 0 } }
    requestRender()
    try { state = { ...state, status: 'ready', result: await runTmdbDiscovery({ onProgress: progress => { state = { ...state, progress }; requestRender() } }), progress: null, showTrace: false } }
    catch { state = { ...state, status: 'ready', error: 'Discovery could not complete. No private history, preference, or identity data was changed.', progress: null } }
    requestRender()
  }
  async function saveAvailability() {
    const region = document.querySelector('#availability-region')?.value?.trim().toUpperCase()
    const serviceNames = (document.querySelector('#availability-services')?.value || '').split(/[\n,]/).map(value => value.trim()).filter(Boolean)
    const priorityServiceNames = (document.querySelector('#availability-priority-services')?.value || '').split(/[\n,]/).map(value => value.trim()).filter(Boolean)
    if (!/^[A-Z]{2}$/.test(region || '')) { state = { ...state, error: 'Use a two-letter country code, such as US.' }; requestRender(); return }
    await writePrivateMetadata({ key: PRIVATE_DISCOVERY_AVAILABILITY_KEY, value: { region, serviceNames, priorityServiceNames } })
    state = { ...state, availability: { region, serviceNames, priorityServiceNames }, success: 'Saved private availability preferences. They are included only in your private backup.', error: null }
    requestRender()
  }
  async function runPreferredServices(providerOnly = false) {
    state = { ...state, status: 'running', error: null, progress: { stage: 'discovering', processed: 0, total: 0 } }
    requestRender()
    try { state = { ...state, status: 'ready', result: await runTmdbPreferredServiceDiscoveryFromPrivateStore({ providerOnly, onProgress: progress => { state = { ...state, progress }; requestRender() } }), progress: null, showTrace: false, success: providerOnly ? 'Built a transient discovery pool from your saved preferred services only.' : 'Built a transient discovery pool using your saved preferred-service availability.' } }
    catch { state = { ...state, status: 'ready', error: 'Preferred-service discovery could not complete. No private history, preference, or identity data was changed.', progress: null } }
    requestRender()
  }
  async function runQualityPilot(cohorts = undefined) {
    state = { ...state, status: 'running', error: null, progress: { stage: 'discovering', processed: 0, total: 0 } }
    requestRender()
    try { state = { ...state, status: 'ready', result: await runTmdbQualityCohortDiscoveryFromPrivateStore({ ...(cohorts ? { cohorts } : {}), onProgress: progress => { state = { ...state, progress }; requestRender() } }), progress: null, showTrace: false, success: cohorts ? 'Built a transient lower-exposure gem pilot from your saved preferred services.' : 'Built a transient six-cohort gem-finding pilot from your saved preferred services.' } }
    catch { state = { ...state, status: 'ready', error: 'The quality-cohort pilot could not complete. No private history, preference, or identity data was changed.', progress: null } }
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
  function exportLlmCandidates() {
    if (!state.result?.joint?.length) return
    const eligible = unevaluatedLlmCandidates(state.result.joint, state.llmBatches)
    if (!eligible.length) { state = { ...state, error: 'Every joint candidate in this result has already been evaluated.' }; requestRender(); return }
    const batch = createLlmCandidateBatch(eligible)
    const blob = new Blob([JSON.stringify(batch, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.href = url
    link.download = `tv-recommendations-llm-candidates-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    state = { ...state, success: `Downloaded ${batch.candidates.length} private joint-eligible candidates for local research and LLM evaluation.` }
    requestRender()
  }
  async function copyLlmCandidates() {
    if (!state.result?.joint?.length) return
    if (!navigator.clipboard?.writeText) {
      state = { ...state, error: 'This browser cannot copy the private candidate batch. Use the download option instead.' }
      requestRender()
      return
    }
    const eligible = unevaluatedLlmCandidates(state.result.joint, state.llmBatches)
    if (!eligible.length) { state = { ...state, error: 'Every joint candidate in this result has already been evaluated.' }; requestRender(); return }
    const batch = createLlmCandidateBatch(eligible)
    try {
      await navigator.clipboard.writeText(JSON.stringify(batch, null, 2))
      state = { ...state, success: `Copied ${batch.candidates.length} private joint-eligible candidates. Paste them into an ignored JSON file under llm-eval/private/candidates/.`, error: null }
    } catch {
      state = { ...state, error: 'The private candidate batch could not be copied. No data was sent anywhere.' }
    }
    requestRender()
  }
  async function previewLlmFile(file) {
    if (!file) return
    state = { ...state, llmPreview: previewLlmEvaluationBatchImport(await file.text(), state.llmBatches), error: null, success: null }
    requestRender()
  }
  async function commitLlmPreview() {
    if (!state.llmPreview?.importable) return
    try {
      const result = await commitLlmEvaluationBatch(state.llmPreview.batch)
      await refreshEvidence()
      state = { ...state, llmPreview: null, success: `Imported ${result.imported} private LLM evaluation(s). They are predictions for review, not preference evidence.` }
    } catch { state = { ...state, error: 'The private LLM evaluation batch could not be imported.' } }
    requestRender()
  }
  function render(storeReady) {
    const result = state.result
    const imported = state.llmBatches.length ? `<p>${state.llmBatches.reduce((count, record) => count + record.llmEvaluationBatch.evaluations.length, 0)} private LLM evaluation(s) imported for review.</p>${llmRanking(state.llmBatches)}` : ''
    const services = state.availability.serviceNames.join(', ')
    const priorityServices = (state.availability.priorityServiceNames || []).join(', ')
    const availability = `<div class="import-preview"><h3>Preferred-service availability (private)</h3><p>Enter service names you subscribe to. Priority services receive most research slots; broader services remain an exploration source. These settings stay in private browser storage. Watch availability data is provided by JustWatch.</p><label>Region <input id="availability-region" value="${escapeHtml(state.availability.region || 'US')}" maxlength="2" /></label><label>All services <input id="availability-services" value="${escapeHtml(services)}" placeholder="One or more service names, separated by commas" /></label><label>Priority curated services <input id="availability-priority-services" value="${escapeHtml(priorityServices)}" placeholder="A subset of the services above" /></label><button class="action-button" id="save-availability" ${storeReady ? '' : 'disabled'}>Save private availability preferences</button><button class="action-button" id="run-quality-cohort-pilot" ${storeReady && state.status !== 'running' && state.availability.serviceNames.length ? '' : 'disabled'}>Run six-cohort gem pilot</button><button class="action-button" id="run-long-tail-pilot" ${storeReady && state.status !== 'running' && state.availability.serviceNames.length ? '' : 'disabled'}>Run lower-exposure gem pilot</button><button class="action-button" id="run-preferred-service-discovery" ${storeReady && state.status !== 'running' && state.availability.serviceNames.length ? '' : 'disabled'}>${state.status === 'running' ? 'Running discovery…' : 'Discover from anchors + services'}</button><button class="action-button" id="run-provider-only-discovery" ${storeReady && state.status !== 'running' && state.availability.serviceNames.length ? '' : 'disabled'}>Search preferred services only</button></div>`
    const pilot = result?.qualityPilot ? `<div class="import-preview"><h3>Gem-pilot coverage</h3><p>${result.qualityPilot.sourceCandidates} source appearances across ${result.qualityPilot.cohorts.length} catalog neighborhoods; ${result.qualityPilot.multiCohortCandidates} titles appeared in more than one neighborhood.</p><ul class="analysis-list">${result.qualityPilot.providerGroups.map(group => `<li><strong>${escapeHtml(group.name)}</strong><span>${group.sourceCandidates} source appearances · ${group.retainedCandidates} retained candidates</span></li>`).join('')}${result.qualityPilot.cohorts.map(cohort => `<li><strong>${escapeHtml(cohort.name)}</strong><span>${cohort.sourceCandidates} found · ${cohort.retainedCandidates} retained after deduplication and watched/rated exclusions</span></li>`).join('')}</ul></div>` : ''
    const unevaluatedCount = result ? unevaluatedLlmCandidates(result.joint, state.llmBatches).length : 0
    return `<section class="import-section" aria-labelledby="discovered-recommendations-heading"><div class="section-heading"><h2 id="discovered-recommendations-heading">Discovered Recommendations</h2><p>Transient browser-local TMDb candidates from confirmed positive anchors or explicit catalog neighborhoods. These are not explicit preferences and are never saved automatically.</p></div><div class="import-panel"><button class="action-button" id="run-tmdb-discovery" ${storeReady && state.status !== 'running' ? '' : 'disabled'}>${state.status === 'running' ? `${state.progress?.stage === 'enriching' ? 'Enriching' : 'Discovering'} ${state.progress?.processed || 0} of ${state.progress?.total || '…'}…` : 'Discover recommendations from confirmed anchors'}</button>${availability}${state.error ? `<p class="import-error">${escapeHtml(state.error)}</p>` : ''}${state.success ? `<p class="import-success">${escapeHtml(state.success)}</p>` : ''}${result ? `<p><strong>${result.seeds.length}</strong> confirmed positive seeds · <strong>${result.candidates.length}</strong> transient unique candidates · Viewer 1 ${result.candidateCounts['viewer-1']} · Viewer 2 ${result.candidateCounts['viewer-2']} · joint ${result.candidateCounts.joint} · <strong>${unevaluatedCount}</strong> joint candidates not previously evaluated.</p>${pilot}<button class="action-button" id="export-llm-candidates">Download up to 15 unevaluated joint candidates</button><button class="action-button" id="copy-llm-candidates">Copy up to 15 unevaluated joint candidates</button>${result.haltedReason ? `<p class="import-error">${escapeHtml(result.haltedReason)}</p>` : ''}${result.errors.length && !result.haltedReason ? `<p class="import-error">${escapeHtml(result.errors[0].message)} ${result.errors.length} TMDb request${result.errors.length === 1 ? '' : 's'} could not complete; successful transient results remain available for this review.</p>` : ''}<div class="analysis-columns"><div><h3>Viewer 1</h3><ul class="analysis-list">${list(result.viewerOne, 'viewer-1')}</ul></div><div><h3>Viewer 2</h3><ul class="analysis-list">${list(result.viewerTwo, 'viewer-2')}</ul></div><div><h3>For both viewers</h3><ul class="analysis-list">${list(result.joint, 'joint')}</ul></div></div><div class="import-preview"><h3>Score Trace (private diagnostic)</h3><p>Transient explanation for the selected diagnostic titles only. It is not saved.</p><button class="action-button" id="toggle-score-trace">${state.showTrace ? 'Hide score trace' : 'Show score trace'}</button>${state.showTrace ? scoreTrace(result) : ''}</div>` : '<p>Anchor discovery keeps at most 40 candidates. The six-cohort pilot can inspect up to 120 deduplicated candidates and enriches only the most useful 25. Running again replaces only this transient in-memory review.</p>'}<div class="import-preview"><h3>Import private LLM evaluations</h3><p>Local-only results from the Node evaluation harness. Import requires this explicit preview and stores predictions separately from preference evidence.</p><input id="llm-evaluation-file" type="file" accept="application/json,.json" ${storeReady ? '' : 'disabled'} />${state.llmPreview ? `<p>${state.llmPreview.batch ? `${state.llmPreview.batch.evaluations.length} evaluation(s) from ${escapeHtml(state.llmPreview.batch.model)}.` : ''} ${escapeHtml(state.llmPreview.problem || '')}</p><button class="action-button" id="confirm-llm-evaluation-import" ${state.llmPreview.importable ? '' : 'disabled'}>Import private LLM evaluation batch</button>` : ''}${imported}</div><div class="import-preview"><h3>Import curated candidate evidence</h3><p>Local-only JSON. Each attribute must state its observed direction, value, confidence, scoring mechanisms, and concise rationale. Evidence is append-only; a later record supersedes prior evidence for the same TMDb work.</p><input id="candidate-evidence-file" type="file" accept="application/json,.json" ${storeReady ? '' : 'disabled'} />${state.preview ? `<p>${state.preview.summary.sourceRecords} source records; ${state.preview.summary.importable} safe to import; ${state.preview.summary.duplicates} duplicates skipped.</p>${state.preview.previewRecords.slice(0, 20).map(record => `<p>${escapeHtml(record.target.canonicalTitle || `TMDb ${record.target.externalId}`)}: <strong>${escapeHtml(record.status)}</strong></p>`).join('')}${state.preview.summary.problems.length ? `<p class="import-error">${escapeHtml(state.preview.summary.problems.join(' '))}</p>` : ''}<button class="action-button" id="confirm-candidate-evidence-import" ${state.preview.records.length ? '' : 'disabled'}>Import candidate evidence</button>` : ''}</div></div></section>`
  }
  function bind(storeReady) {
    if (!storeReady) return
    if (!evidenceLoaded) {
      evidenceLoaded = true
      refreshEvidence().then(requestRender)
    }
    document.querySelector('#run-tmdb-discovery')?.addEventListener('click', run)
    document.querySelector('#save-availability')?.addEventListener('click', saveAvailability)
    document.querySelector('#run-preferred-service-discovery')?.addEventListener('click', () => runPreferredServices())
    document.querySelector('#run-provider-only-discovery')?.addEventListener('click', () => runPreferredServices(true))
    document.querySelector('#run-quality-cohort-pilot')?.addEventListener('click', () => runQualityPilot())
    document.querySelector('#run-long-tail-pilot')?.addEventListener('click', () => runQualityPilot(LONG_TAIL_DISCOVERY_COHORTS))
    document.querySelector('#export-llm-candidates')?.addEventListener('click', exportLlmCandidates)
    document.querySelector('#copy-llm-candidates')?.addEventListener('click', copyLlmCandidates)
    document.querySelector('#toggle-score-trace')?.addEventListener('click', () => { state = { ...state, showTrace: !state.showTrace }; requestRender() })
    document.querySelector('#candidate-evidence-file')?.addEventListener('change', event => previewFile(event.target.files?.[0]))
    document.querySelector('#llm-evaluation-file')?.addEventListener('change', event => previewLlmFile(event.target.files?.[0]))
    document.querySelector('#confirm-llm-evaluation-import')?.addEventListener('click', commitLlmPreview)
    document.querySelector('#confirm-candidate-evidence-import')?.addEventListener('click', commitPreview)
  }
  return { render, bind }
}
