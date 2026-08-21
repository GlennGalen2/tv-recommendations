import { createServer } from 'node:http'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadLocalCredential } from './credentials.js'
import { createOpenAiResponsesAdapter, createOpenAiWebResearchAdapter } from './providers/openai.js'
import { createPrivateResearchQueue, privateQueueSummary, runPrivateResearchQueue } from './researchQueue.js'
import { readPrivateResearchQueue, writePrivateResearchQueue } from './researchQueueStore.js'
import { writePrivateResearchPacket } from './researchStore.js'
import { validateLlmCandidateBatch } from '../src/data/llmEvaluationBatch.js'

const HOST = '127.0.0.1'
const PORT = Number(process.env.TV_RECOMMENDATIONS_RUNNER_PORT || 5119)
const ROOT = resolve('llm-eval/private')
const QUEUE_DIRECTORY = join(ROOT, 'queues')
const RESEARCH_DIRECTORY = join(ROOT, 'candidate-research')
const PROFILE_PATH = join(ROOT, 'viewer-preferences.md')
const ALLOWED_ORIGINS = new Set(['http://127.0.0.1:5173', 'http://localhost:5173'])
let activeRun = null

function send(response, status, body, origin = null) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { 'access-control-allow-origin': origin, vary: 'origin' } : {})
  })
  response.end(JSON.stringify(body))
}

function safeError(error) {
  return error instanceof Error ? error.message : 'The local runner could not complete that request.'
}

async function bodyOf(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 1_000_000) throw new Error('Request is too large.')
  }
  return body ? JSON.parse(body) : {}
}

async function queueFiles() {
  try {
    return (await readdir(QUEUE_DIRECTORY, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => join(QUEUE_DIRECTORY, entry.name))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function recommendations() {
  const queues = await Promise.all((await queueFiles()).map(async path => {
    try { return await readPrivateResearchQueue({ path }) } catch { return null }
  }))
  const newestByTarget = new Map()
  for (const queue of queues.filter(Boolean)) {
    for (const item of queue.items.filter(item => item.status === 'completed' && item.evaluation?.evaluation)) {
      const completedAt = item.evaluation.completedAt || queue.createdAt
      const key = `${item.target.provider}:${item.target.mediaType}:${item.target.externalId}`
      const current = newestByTarget.get(key)
      if (!current || String(completedAt).localeCompare(String(current.completedAt)) > 0) {
        newestByTarget.set(key, {
          id: key,
          batchId: queue.id,
          completedAt,
          target: item.target,
          evaluation: item.evaluation.evaluation,
          researchModel: item.researchMetrics?.model || null,
          evaluationModel: item.evaluation.model || null
        })
      }
    }
  }
  return [...newestByTarget.values()].sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt)))
}

async function startRun({ candidateBatch, maxCostCents = 150 }) {
  validateLlmCandidateBatch(candidateBatch)
  if (!Number.isInteger(maxCostCents) || maxCostCents < 1 || maxCostCents > 1000) throw new Error('Choose a local run cap between 1 and 1000 cents.')
  if (activeRun?.status === 'running') throw new Error('A local recommendation run is already in progress.')
  await mkdir(QUEUE_DIRECTORY, { recursive: true })
  await mkdir(RESEARCH_DIRECTORY, { recursive: true })
  const queuePath = join(QUEUE_DIRECTORY, `v1-${candidateBatch.id}.json`)
  const queue = createPrivateResearchQueue({ candidateBatch, maxCostCents, reservedCostCentsPerCandidate: 3 })
  await writePrivateResearchQueue({ queue, path: queuePath })
  activeRun = { id: queue.id, startedAt: new Date().toISOString(), total: queue.items.length, status: 'running', error: null }
  void (async () => {
    try {
      const [profile, apiKey] = await Promise.all([readFile(PROFILE_PATH, 'utf8'), loadLocalCredential({ name: 'OPENAI_API_KEY' })])
      const result = await runPrivateResearchQueue({
        queue,
        researchAdapter: createOpenAiWebResearchAdapter({ model: 'gpt-5.4-nano', apiKey }),
        evaluationAdapter: createOpenAiResponsesAdapter({ model: 'gpt-5.4-mini', apiKey }),
        viewerProfile: profile,
        loadResearchPacket: async path => { try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null } },
        saveResearchPacket: async ({ packet, item }) => (await writePrivateResearchPacket({ packet, outputDirectory: RESEARCH_DIRECTORY, filename: `${item.target.mediaType}-${item.target.externalId}.json` })).path,
        persistQueue: async value => { await writePrivateResearchQueue({ queue: value, path: queuePath }) }
      })
      activeRun = { ...activeRun, status: 'completed', finishedAt: new Date().toISOString(), summary: privateQueueSummary(result.queue) }
    } catch (error) {
      activeRun = { ...activeRun, status: 'failed', finishedAt: new Date().toISOString(), error: safeError(error) }
    }
  })()
  return { queueId: queue.id, items: queue.items.length, maxCostCents }
}

createServer(async (request, response) => {
  const origin = request.headers.origin
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { ...(origin && ALLOWED_ORIGINS.has(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {}) })
    response.end()
    return
  }
  try {
    if (request.method === 'GET' && request.url === '/api/status') return send(response, 200, { running: activeRun?.status === 'running', run: activeRun }, origin)
    if (request.method === 'GET' && request.url === '/api/recommendations') return send(response, 200, { recommendations: await recommendations() }, origin)
    if (request.method === 'POST' && request.url === '/api/runs') return send(response, 202, await startRun(await bodyOf(request)), origin)
    return send(response, 404, { error: 'Not found.' }, origin)
  } catch (error) {
    return send(response, 400, { error: safeError(error) }, origin)
  }
}).listen(PORT, HOST, () => {
  console.log(`TV recommendation runner is listening at http://${HOST}:${PORT}`)
})
