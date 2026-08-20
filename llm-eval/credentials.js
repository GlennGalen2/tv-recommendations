import { readFile as readLocalFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const DEFAULT_SECRETS_FILE = resolve('llm-eval.secrets.local.json')

export async function loadLocalCredential({
  name,
  environment = process.env,
  secretsFile = DEFAULT_SECRETS_FILE,
  readFile = readLocalFile
} = {}) {
  const environmentValue = environment[name]
  if (typeof environmentValue === 'string' && environmentValue.trim()) return environmentValue.trim()

  let contents
  try {
    contents = await readFile(secretsFile, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Missing required local credential: ${name}`)
    throw new Error(`Unable to read local credentials file for ${name}`)
  }

  let secrets
  try {
    secrets = JSON.parse(contents)
  } catch {
    throw new Error(`Local credentials file is invalid for ${name}`)
  }

  const localValue = secrets?.[name]
  if (typeof localValue !== 'string' || !localValue.trim()) throw new Error(`Missing required local credential: ${name}`)
  return localValue.trim()
}
