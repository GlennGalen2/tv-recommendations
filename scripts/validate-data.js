import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = new URL('../data/v1/', import.meta.url)
const rootPath = fileURLToPath(root)

function read(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, root), 'utf8'))
}

function unique(records, label) {
  const ids = records.map(record => record.id)
  assert.equal(new Set(ids).size, ids.length, `${label} IDs must be unique`)
  return new Set(ids)
}

function requireVersion(file, label) {
  assert.equal(file.schemaVersion, 1, `${label} must use schemaVersion 1`)
}

function requirePublicDemoClassification(file, label) {
  assert.equal(
    file.dataClassification,
    'public-demo',
    `${label} must be explicitly classified as public-demo`
  )
}

function findJsonFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return entry.name === 'schemas' ? [] : findJsonFiles(path)
    }

    return entry.name.endsWith('.json') ? [path] : []
  })
}

function requireReferences(values, validIds, label) {
  for (const value of values) {
    assert(validIds.has(value), `${label} references missing ID: ${value}`)
  }
}

const catalog = read('catalog/titles.json')
const viewerData = read('people/viewers.json')
const groupData = read('people/groups.json')
const sourceData = read('provenance/sources.json')
const batchData = read('provenance/import-batches.json')
const historyData = read('history/events.json')
const reactionData = read('reactions/reactions.json')
const evidenceData = read('preferences/evidence.json')
const recommendationData = read('recommendations/recommendations.json')

for (const [label, file] of Object.entries({
  catalog,
  viewers: viewerData,
  groups: groupData,
  sources: sourceData,
  batches: batchData,
  history: historyData,
  reactions: reactionData,
  evidence: evidenceData,
  recommendations: recommendationData
})) {
  requireVersion(file, label)
  requirePublicDemoClassification(file, label)
}

for (const filePath of findJsonFiles(rootPath)) {
  const file = JSON.parse(readFileSync(filePath, 'utf8'))
  const label = filePath.slice(rootPath.length)
  requireVersion(file, label)
  requirePublicDemoClassification(file, label)
}

const titleIds = unique(catalog.titles, 'Title')
const viewerIds = unique(viewerData.viewers, 'Viewer')
const groupIds = unique(groupData.groups, 'Group')
const sourceIds = unique(sourceData.sources, 'Source')
const batchIds = unique(batchData.batches, 'Import batch')
const eventIds = unique(historyData.events, 'History event')
const reactionIds = unique(reactionData.reactions, 'Reaction')
const evidenceIds = unique(evidenceData.evidence, 'Preference evidence')
unique(recommendationData.recommendations, 'Recommendation')

assert.deepEqual(
  [...viewerIds].sort(),
  ['viewer-1', 'viewer-2'],
  'Public data must use only the neutral viewer IDs'
)

for (const group of groupData.groups) {
  requireReferences(group.viewerIds, viewerIds, `Group ${group.id}`)
}

for (const batch of batchData.batches) {
  assert(sourceIds.has(batch.sourceId), `Batch ${batch.id} has an unknown source`)
  assert.equal(batch.synthetic, true, `Public batch ${batch.id} must be synthetic`)
}

for (const event of historyData.events) {
  assert.match(event.id, /^evt_[A-Za-z0-9]+$/, `Event ${event.id} must have an opaque ID`)
  requireReferences(event.viewerIds, viewerIds, `Event ${event.id}`)
  if (event.titleId !== null) {
    assert(titleIds.has(event.titleId), `Event ${event.id} has an unknown title`)
  }
  assert(sourceIds.has(event.provenance.sourceId), `Event ${event.id} has an unknown source`)
  assert.equal(event.provenance.sourceId, 'source:demo', `Public event ${event.id} must be synthetic`)
  if (event.provenance.importBatchId !== null) {
    assert(batchIds.has(event.provenance.importBatchId), `Event ${event.id} has an unknown batch`)
  }
  if (event.mediaScope.level === 'episode') {
    assert(Number.isInteger(event.mediaScope.seasonNumber), `Episode event ${event.id} needs a season number`)
    assert(Number.isInteger(event.mediaScope.episodeNumber), `Episode event ${event.id} needs an episode number`)
  }
}

for (const reaction of reactionData.reactions) {
  assert.match(reaction.id, /^rct_[A-Za-z0-9]+$/, `Reaction ${reaction.id} must have an opaque ID`)
  assert(viewerIds.has(reaction.viewerId), `Reaction ${reaction.id} has an unknown viewer`)
  assert(titleIds.has(reaction.titleId), `Reaction ${reaction.id} has an unknown title`)
  assert.equal(reaction.provenance.sourceId, 'source:demo', `Public reaction ${reaction.id} must be synthetic`)
  if (reaction.supersedesReactionId !== null) {
    assert(reactionIds.has(reaction.supersedesReactionId), `Reaction ${reaction.id} supersedes a missing reaction`)
    const previous = reactionData.reactions.find(item => item.id === reaction.supersedesReactionId)
    assert.equal(previous.viewerId, reaction.viewerId, `Reaction ${reaction.id} changes viewer while superseding`)
    assert.equal(previous.titleId, reaction.titleId, `Reaction ${reaction.id} changes title while superseding`)
    assert(new Date(previous.recordedAt) < new Date(reaction.recordedAt), `Reaction ${reaction.id} must supersede an older record`)
  }
}

for (const evidence of evidenceData.evidence) {
  assert.equal(evidence.evidenceType, 'inferred', `Evidence ${evidence.id} must remain distinguishable as inferred`)
  assert(viewerIds.has(evidence.viewerId), `Evidence ${evidence.id} has an unknown viewer`)
  for (const basis of evidence.basedOn) {
    const valid = basis.recordType === 'reaction'
      ? reactionIds
      : basis.recordType === 'history-event'
        ? eventIds
        : evidenceIds
    assert(valid.has(basis.recordId), `Evidence ${evidence.id} has a missing basis record`)
  }
}

for (const recommendation of recommendationData.recommendations) {
  assert(titleIds.has(recommendation.titleId), `Recommendation ${recommendation.id} has an unknown title`)
  assert.equal(recommendation.provenance.sourceId, 'source:demo', `Public recommendation ${recommendation.id} must be synthetic`)
  const targetIds = recommendation.target.kind === 'viewer' ? viewerIds : groupIds
  assert(targetIds.has(recommendation.target.id), `Recommendation ${recommendation.id} has an unknown target`)
  requireReferences(
    recommendation.viewerScores.map(item => item.viewerId),
    viewerIds,
    `Recommendation ${recommendation.id}`
  )
  for (const viewerScore of recommendation.viewerScores) {
    requireReferences(viewerScore.evidenceIds, evidenceIds, `Score for ${viewerScore.viewerId}`)
  }
  assert.notEqual(recommendation.workflowStatus, 'watched', 'Watched must be derived from authoritative history')
  if (recommendation.target.kind === 'group') {
    assert(recommendation.jointScore, `Group recommendation ${recommendation.id} needs a joint score`)
    assert.notEqual(recommendation.jointScore.method, 'simple-average', 'A simple average cannot be the joint scoring method')
    assert(recommendation.jointScore.disagreementPenalty >= 0, 'Joint scores must expose a disagreement penalty')
    const group = groupData.groups.find(item => item.id === recommendation.target.id)
    assert.deepEqual(
      recommendation.viewerScores.map(item => item.viewerId).sort(),
      [...group.viewerIds].sort(),
      `Group recommendation ${recommendation.id} must preserve every viewer score`
    )
  } else {
    assert.equal(recommendation.jointScore, null, `Viewer recommendation ${recommendation.id} cannot have a joint score`)
  }
}

// Formal JSON Schemas are versioned contracts for now. This integrity script
// checks that the contract files are readable and consistently identified; it
// does not execute JSON Schema validation.
const contractDirectory = new URL('schemas/', root)
for (const fileName of readdirSync(contractDirectory)) {
  if (fileName.endsWith('.json')) {
    const contract = JSON.parse(readFileSync(new URL(fileName, contractDirectory), 'utf8'))
    assert.equal(contract.$schema, 'https://json-schema.org/draft/2020-12/schema', `${fileName} has the wrong JSON Schema draft`)
  }
}

const forbiddenRawDirectories = ['imports', 'raw', 'exports']
for (const directory of forbiddenRawDirectories) {
  assert.equal(
    existsSync(join(rootPath, directory)),
    false,
    `Raw data directory must not exist in public data: ${directory}`
  )
}

console.log('Checked public data v1 integrity: file versions, classifications, IDs, relationships, provenance, and privacy invariants are consistent.')
