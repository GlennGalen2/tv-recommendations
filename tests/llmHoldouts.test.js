import assert from 'node:assert/strict'
import { createHoldoutProfile, validateHoldoutManifest } from '../llm-eval/holdouts.js'
import { createBenchmarkResultDocument, writeBenchmarkResult } from '../llm-eval/resultStore.js'

const profile = `# Synthetic profile\n\n<!-- llm-anchor:synthetic-anchor:start -->\nSynthetic anchor evidence.\n<!-- llm-anchor:synthetic-anchor:end -->\n\nIndependent synthetic evidence.`
const manifest = { schemaVersion: 1, targets: [{ benchmarkCaseId: 'synthetic-case', excludeProfileBlockIds: ['synthetic-anchor'] }] }

assert.equal(validateHoldoutManifest(manifest), manifest)
const heldOut = createHoldoutProfile({ viewerProfile: profile, manifest, benchmarkCaseId: 'synthetic-case' })
assert.equal(heldOut.viewerProfile.includes('Synthetic anchor evidence.'), false)
assert.equal(heldOut.viewerProfile.includes('Independent synthetic evidence.'), true)
assert.deepEqual(heldOut.excludedProfileBlockIds, ['synthetic-anchor'])
assert.throws(() => createHoldoutProfile({ viewerProfile: profile, manifest, benchmarkCaseId: 'unmarked-case' }), /No holdout rule/)
assert.throws(() => createHoldoutProfile({ viewerProfile: '# No markers', manifest, benchmarkCaseId: 'synthetic-case' }), /not explicitly marked/)

const report = { provider: 'synthetic-provider', model: 'synthetic-model', results: [{ id: 'synthetic-case' }] }
const document = createBenchmarkResultDocument({ report, createdAt: '2026-08-19T12:34:56.789Z' })
assert.equal(document.schemaVersion, 1)
assert.equal(document.report, report)
let directory; let temporary; let finalPath; let contents
const stored = await writeBenchmarkResult({ report, outputDirectory: 'C:/synthetic-private-results/results', privateRoot: 'C:/synthetic-private-results', createdAt: '2026-08-19T12:34:56.789Z', mkdirImpl: async path => { directory = path }, writeFileImpl: async (path, text) => { temporary = path; contents = text }, renameImpl: async (from, to) => { assert.equal(from, temporary); finalPath = to } })
assert.equal(directory.endsWith('synthetic-private-results\\results'), true)
assert.equal(temporary.endsWith('.tmp'), true)
assert.equal(finalPath, stored.path)
assert.equal(contents.includes('synthetic-provider'), true)
assert.equal(contents.includes('OPENAI_API_KEY'), false)
await assert.rejects(writeBenchmarkResult({ report, outputDirectory: 'C:/not-private', privateRoot: 'C:/synthetic-private-results' }), /inside llm-eval\/private/)

console.log('LLM holdout and private result-store checks passed.')
