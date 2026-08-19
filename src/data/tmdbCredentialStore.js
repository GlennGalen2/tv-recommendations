const DATABASE_NAME = 'tv-recommendations-credentials'
const DATABASE_VERSION = 1
const STORE_NAME = 'credentials'
const TOKEN_KEY = 'tmdb-api-read-access-token'

let databasePromise

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionAsPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}

function requireIndexedDb() {
  if (typeof indexedDB === 'undefined') {
    throw new Error('Private credential storage is unavailable in this browser context.')
  }
}

export function isTmdbCredentialStoreSupported() {
  return typeof indexedDB !== 'undefined'
}

export function openTmdbCredentialStore() {
  requireIndexedDb()
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => {
        const database = request.result
        database.onversionchange = () => {
          database.close()
          databasePromise = undefined
        }
        resolve(database)
      }
      request.onerror = () => {
        databasePromise = undefined
        reject(request.error)
      }
      request.onblocked = () => reject(new Error('Close other app tabs before updating private credential storage.'))
    })
  }
  return databasePromise
}

function requireToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new TypeError('A TMDb API Read Access Token is required.')
  }
  return token.trim()
}

export async function saveTmdbReadAccessToken(token, { database: providedDatabase } = {}) {
  const value = requireToken(token)
  const database = providedDatabase || await openTmdbCredentialStore()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  transaction.objectStore(STORE_NAME).put({
    key: TOKEN_KEY,
    value,
    storedAt: new Date().toISOString()
  })
  await transactionAsPromise(transaction)
  return { configured: true }
}

export async function getTmdbReadAccessToken({ database: providedDatabase } = {}) {
  const database = providedDatabase || await openTmdbCredentialStore()
  const transaction = database.transaction(STORE_NAME, 'readonly')
  const record = await requestAsPromise(transaction.objectStore(STORE_NAME).get(TOKEN_KEY))
  await transactionAsPromise(transaction)
  return typeof record?.value === 'string' && record.value ? record.value : null
}

export async function getTmdbCredentialStatus(options) {
  return { configured: Boolean(await getTmdbReadAccessToken(options)) }
}

export async function clearTmdbReadAccessToken({ database: providedDatabase } = {}) {
  const database = providedDatabase || await openTmdbCredentialStore()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  transaction.objectStore(STORE_NAME).delete(TOKEN_KEY)
  await transactionAsPromise(transaction)
  return { configured: false }
}
