function targetKey(target) { return `${target.provider}:${target.mediaType}:${target.externalId}` }

function latestEvidence(records = []) {
  const superseded = new Set(records.map(record => record.supersedesEvidenceId).filter(Boolean))
  return new Map(records.filter(record => !superseded.has(record.id)).map(record => [targetKey(record.target), record]))
}

function normalizeAttribute(attribute) {
  return {
    attribute: String(attribute?.attribute || '').trim(),
    direction: attribute?.direction,
    value: attribute?.value,
    confidence: attribute?.confidence,
    mechanisms: [...new Set(Array.isArray(attribute?.mechanisms) ? attribute.mechanisms.map(value => String(value).trim()).filter(Boolean) : [])],
    source: String(attribute?.source || '').trim(),
    rationale: String(attribute?.rationale || '').trim()
  }
}

function validAttribute(attribute) {
  return attribute.attribute && ['present', 'absent'].includes(attribute.direction)
    && Number.isFinite(attribute.value) && attribute.value >= 0 && attribute.value <= 1
    && Number.isFinite(attribute.confidence) && attribute.confidence >= 0 && attribute.confidence <= 1
    && attribute.mechanisms.length && attribute.source && attribute.rationale
}

function sameEvidence(left, right) {
  return JSON.stringify(left.attributes) === JSON.stringify(right.attributes)
}

export function previewCandidateEvidenceImport(jsonText, { evidence = [], fileName = null } = {}) {
  const parsed = JSON.parse(jsonText)
  if (parsed?.format !== 'tv-recommendations-candidate-enrichment' || parsed.formatVersion !== 1 || !Array.isArray(parsed.records)) {
    throw new TypeError('Not a supported candidate-enrichment JSON file.')
  }
  const current = latestEvidence(evidence)
  const records = []
  const previewRecords = []
  const problems = []
  let duplicates = 0
  for (const [index, input] of parsed.records.entries()) {
    const target = {
      provider: input?.target?.provider || 'tmdb', externalId: String(input?.target?.externalId || input?.tmdbId || '').trim(),
      mediaType: input?.target?.mediaType || input?.mediaType, canonicalTitle: typeof input?.target?.canonicalTitle === 'string' ? input.target.canonicalTitle.trim() : null
    }
    const attributes = (Array.isArray(input?.attributes) ? input.attributes : []).map(normalizeAttribute)
    if (target.provider !== 'tmdb' || !target.externalId || !['movie', 'tv'].includes(target.mediaType) || !attributes.length || attributes.some(attribute => !validAttribute(attribute))) {
      problems.push(`Record ${index + 1} lacks a valid TMDb target or qualitative attribute.`)
      previewRecords.push({ index, target, status: 'invalid' })
      continue
    }
    const previous = current.get(targetKey(target))
    const record = {
      id: input.id || `ce_${crypto.randomUUID()}`, schemaVersion: 1, target,
      attributes, recordedAt: input.recordedAt || new Date().toISOString(),
      supersedesEvidenceId: previous?.id || null,
      provenance: { sourceId: 'source:manual', sourceRecordId: input.provenance?.sourceRecordId || null, importFileName: fileName || null, importFormat: 'candidate-enrichment:v1' }
    }
    if (evidence.some(candidate => candidate.id === record.id) || (previous && sameEvidence(previous, record))) {
      duplicates += 1
      previewRecords.push({ index, target, status: 'duplicate', attributes })
      continue
    }
    records.push(record)
    current.set(targetKey(target), record)
    previewRecords.push({ index, target, status: previous ? 'supersedes-current-evidence' : 'new', attributes })
  }
  return { records, previewRecords, summary: { sourceRecords: parsed.records.length, importable: records.length, duplicates, problems } }
}

export function currentCandidateEvidence(records = []) {
  return [...latestEvidence(records).values()]
}
