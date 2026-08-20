import assert from 'node:assert/strict'
import { createOpenAiWebResearchAdapter } from '../llm-eval/providers/openai.js'
import { RESEARCH_PACKET_SCHEMA, researchCandidate } from '../llm-eval/research.js'
import { writePrivateResearchPacket } from '../llm-eval/researchStore.js'

const target = { title: 'Synthetic Research Target', mediaType: 'tv', year: 2025 }
const packet = {
  title: 'Synthetic Research Target', year: 2025, mediaType: 'tv', synopsis: 'Synthetic synopsis.',
  criticalObservations: ['Synthetic observations.'], protagonistMoralSetup: 'Synthetic moral setup.', violenceBrutalityNotes: 'Synthetic violence notes.', dialogueToneNotes: 'Synthetic dialogue notes.', professionalRealismNotes: 'Synthetic realism notes.', storytellingMysteryNotes: 'Synthetic storytelling notes.',
  sources: [{ provider: 'Synthetic Review One', reference: 'Synthetic one', url: 'https://example.test/one' }, { provider: 'Synthetic Review Two', reference: 'Synthetic two', url: 'https://example.test/two' }],
  uncertainties: ['Synthetic uncertainty.']
}

let request
const adapter = createOpenAiWebResearchAdapter({ model: 'synthetic-model', apiKey: 'synthetic-secret', fetchImpl: async (url, options) => {
  request = { url, options }
  return { ok: true, status: 200, json: async () => ({ output_text: JSON.stringify(packet), usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } }) }
} })
const result = await researchCandidate({ adapter, target })
assert.equal(result.packet.title, target.title)
assert.equal(result.usage.totalTokens, 18)
const requestBody = JSON.parse(request.options.body)
assert.equal(requestBody.store, false)
assert.equal(requestBody.tools[0].type, 'web_search')
assert.equal(requestBody.tool_choice, 'required')
assert.deepEqual(requestBody.text.format.schema, RESEARCH_PACKET_SCHEMA)
assert.equal(request.options.body.includes('synthetic-secret'), false)
assert.equal(requestBody.input.includes('Synthetic Research Target'), true)
assert.equal(requestBody.input.includes('copy title exactly'), true)

const punctuationResult = await researchCandidate({ adapter: { async research() { return { text: JSON.stringify({ ...packet, title: 'Synthetic—Research Target' }) } } }, target })
assert.equal(punctuationResult.packet.title, target.title)

await assert.rejects(researchCandidate({ adapter: { async research() { return { text: JSON.stringify({ ...packet, title: 'Wrong' }) } } }, target }), error => error.type === 'research_target_mismatch')
await assert.rejects(researchCandidate({ adapter: { async research() { return { text: JSON.stringify({ ...packet, year: 2024 }) } } }, target }), error => error.type === 'research_target_mismatch')

const written = []
const output = await writePrivateResearchPacket({ packet, outputDirectory: 'llm-eval/private/test-research', filename: 'synthetic.json', mkdirImpl: async () => {}, writeFileImpl: async (path, contents) => { written.push({ path, contents }) }, renameImpl: async (from, to) => { written.push({ from, to }) } })
assert.equal(output.path.endsWith('llm-eval\\private\\test-research\\synthetic.json'), true)
assert.equal(written[0].contents.includes('Synthetic Research Target'), true)
await assert.rejects(writePrivateResearchPacket({ packet, outputDirectory: 'outside-private', mkdirImpl: async () => {}, writeFileImpl: async () => {}, renameImpl: async () => {} }), /inside llm-eval\/private/)

console.log('LLM web-research checks passed.')
