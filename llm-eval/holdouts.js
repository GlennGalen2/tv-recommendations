const HOLDOUT_MANIFEST_SCHEMA_VERSION = 1
const MARKER_PATTERN = /<!--\s*llm-anchor:([a-z0-9][a-z0-9-]*):(start|end)\s*-->/gi

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`)
}

export function validateHoldoutManifest(manifest) {
  requireObject(manifest, 'Holdout manifest')
  if (manifest.schemaVersion !== HOLDOUT_MANIFEST_SCHEMA_VERSION) throw new TypeError('Holdout manifest has an unsupported schemaVersion.')
  if (!Array.isArray(manifest.targets)) throw new TypeError('Holdout manifest requires a targets array.')
  const seenCaseIds = new Set()
  for (const target of manifest.targets) {
    requireObject(target, 'Holdout target')
    if (typeof target.benchmarkCaseId !== 'string' || !target.benchmarkCaseId.trim()) throw new TypeError('Each holdout target requires benchmarkCaseId.')
    if (seenCaseIds.has(target.benchmarkCaseId)) throw new TypeError('Holdout manifest cannot repeat benchmarkCaseId values.')
    seenCaseIds.add(target.benchmarkCaseId)
    if (!Array.isArray(target.excludeProfileBlockIds) || !target.excludeProfileBlockIds.length || target.excludeProfileBlockIds.some(id => typeof id !== 'string' || !id.trim())) throw new TypeError('Each holdout target requires one or more excludeProfileBlockIds.')
  }
  return manifest
}

function profileBlocks(profile) {
  const markers = [...profile.matchAll(MARKER_PATTERN)]
  const blocks = new Map()
  const open = new Map()
  for (const marker of markers) {
    const [, id, boundary] = marker
    if (boundary.toLowerCase() === 'start') {
      if (open.has(id) || blocks.has(id)) throw new TypeError(`Profile anchor block ${id} is malformed.`)
      open.set(id, { start: marker.index, contentStart: marker.index + marker[0].length })
    } else {
      const beginning = open.get(id)
      if (!beginning) throw new TypeError(`Profile anchor block ${id} has an end marker without a start marker.`)
      blocks.set(id, { start: beginning.start, end: marker.index + marker[0].length, content: profile.slice(beginning.contentStart, marker.index) })
      open.delete(id)
    }
  }
  if (open.size) throw new TypeError(`Profile anchor block ${[...open.keys()][0]} has no end marker.`)
  return blocks
}

export function createHoldoutProfile({ viewerProfile, manifest, benchmarkCaseId }) {
  if (typeof viewerProfile !== 'string' || !viewerProfile.trim()) throw new TypeError('A non-empty viewer profile is required.')
  validateHoldoutManifest(manifest)
  const target = manifest.targets.find(entry => entry.benchmarkCaseId === benchmarkCaseId)
  if (!target) throw new TypeError(`No holdout rule exists for benchmark case ${benchmarkCaseId}.`)
  const blocks = profileBlocks(viewerProfile)
  const excluded = target.excludeProfileBlockIds.map(id => {
    const block = blocks.get(id)
    if (!block) throw new TypeError(`Profile anchor block ${id} is not explicitly marked.`)
    return { id, ...block }
  }).sort((left, right) => right.start - left.start)
  let holdoutProfile = viewerProfile
  for (const block of excluded) holdoutProfile = `${holdoutProfile.slice(0, block.start)}${holdoutProfile.slice(block.end)}`
  return { viewerProfile: holdoutProfile.trim(), excludedProfileBlockIds: excluded.map(block => block.id) }
}

