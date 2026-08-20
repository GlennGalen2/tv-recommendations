import { mkdir, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { validateResearchPacket } from './evaluator.js'

function safeSegment(value) { return String(value || 'unknown').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'unknown' }

export async function writePrivateResearchPacket({ packet, outputDirectory, filename, privateRoot = resolve('llm-eval/private'), mkdirImpl = mkdir, writeFileImpl = writeFile, renameImpl = rename }) {
  validateResearchPacket(packet)
  const privateDirectory = resolve(privateRoot)
  const destination = resolve(outputDirectory)
  const pathFromPrivateRoot = relative(privateDirectory, destination)
  if (pathFromPrivateRoot.startsWith('..') || isAbsolute(pathFromPrivateRoot)) throw new TypeError('Research packets must be written inside llm-eval/private/.')
  const path = resolve(join(destination, filename || `${safeSegment(packet.mediaType)}-${safeSegment(packet.title)}.json`))
  const temporaryPath = `${path}.tmp`
  await mkdirImpl(destination, { recursive: true })
  await writeFileImpl(temporaryPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8')
  await renameImpl(temporaryPath, path)
  return { path }
}
