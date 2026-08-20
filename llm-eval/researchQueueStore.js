import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { validatePrivateResearchQueue } from './researchQueue.js'

function privatePath(path, privateRoot) {
  const root = resolve(privateRoot)
  const destination = resolve(path)
  const relativePath = relative(root, destination)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) throw new TypeError('Private research queues must remain inside llm-eval/private/.')
  return destination
}

export async function readPrivateResearchQueue({ path, readFileImpl = readFile, privateRoot = resolve('llm-eval/private') } = {}) {
  return validatePrivateResearchQueue(JSON.parse(await readFileImpl(privatePath(path, privateRoot), 'utf8')))
}

export async function writePrivateResearchQueue({ queue, path, privateRoot = resolve('llm-eval/private'), mkdirImpl = mkdir, writeFileImpl = writeFile, renameImpl = rename } = {}) {
  validatePrivateResearchQueue(queue)
  const destination = privatePath(path, privateRoot)
  if (!basename(destination).endsWith('.json')) throw new TypeError('Private research queue path must end in .json.')
  await mkdirImpl(resolve(destination, '..'), { recursive: true })
  const temporaryPath = `${destination}.tmp`
  await writeFileImpl(temporaryPath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8')
  await renameImpl(temporaryPath, destination)
  return { path: destination }
}
