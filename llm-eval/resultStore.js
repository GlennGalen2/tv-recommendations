import { mkdir, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

export const BENCHMARK_RESULT_SCHEMA_VERSION = 1

function safeSegment(value) { return String(value || 'unknown').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'unknown' }

export function createBenchmarkResultDocument({ report, createdAt = new Date().toISOString() }) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new TypeError('A benchmark report is required.')
  return { schemaVersion: BENCHMARK_RESULT_SCHEMA_VERSION, createdAt, provider: report.provider, model: report.model, report }
}

export async function writeBenchmarkResult({ report, outputDirectory, privateRoot = resolve('llm-eval/private'), createdAt, mkdirImpl = mkdir, writeFileImpl = writeFile, renameImpl = rename }) {
  if (typeof outputDirectory !== 'string' || !outputDirectory.trim()) throw new TypeError('A private results directory is required.')
  const privateDirectory = resolve(privateRoot)
  const resolvedOutputDirectory = resolve(outputDirectory)
  const pathFromPrivateRoot = relative(privateDirectory, resolvedOutputDirectory)
  if (pathFromPrivateRoot.startsWith('..') || isAbsolute(pathFromPrivateRoot)) throw new TypeError('Benchmark results must be written inside llm-eval/private/.')
  const document = createBenchmarkResultDocument({ report, createdAt })
  const timestamp = document.createdAt.replace(/[:.]/g, '-').replace(/Z$/, 'Z')
  const filename = `benchmark-${timestamp}-${safeSegment(document.provider)}-${safeSegment(document.model)}.json`
  const path = resolve(join(resolvedOutputDirectory, filename))
  const temporaryPath = `${path}.tmp`
  await mkdirImpl(resolvedOutputDirectory, { recursive: true })
  await writeFileImpl(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await renameImpl(temporaryPath, path)
  return { path, filename, document }
}
