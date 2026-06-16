/**
 * KeyStore — persist the Anthropic API key without manual .env editing.
 *
 * Priority order (read):
 *   1. process.env.ANTHROPIC_API_KEY  (already set — e.g. from .env at startup)
 *   2. macOS Keychain                 (stored via `security` CLI on Mac)
 *   3. data/keys.json                 (cross-platform fallback file)
 *
 * On write: saved to ALL available stores so the key survives restarts.
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ENV_FILE  = join(__dir, '../.env')
const KEYS_FILE = join(__dir, '../data/keys.json')
const DATA_DIR  = join(__dir, '../data')

const KEYCHAIN_ACCOUNT = 'anthropic_api_key'
const KEYCHAIN_SERVICE = 'vac_clarity'

// ── macOS Keychain ────────────────────────────────────────────────────────────

function keychainRead() {
  try {
    const out = execSync(
      `security find-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE}" -w 2>/dev/null`,
      { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
    return out || null
  } catch {
    return null
  }
}

function keychainWrite(key) {
  try {
    execSync(
      `security add-generic-password -U -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE}" -w ${JSON.stringify(key)} 2>/dev/null`,
      { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return true
  } catch {
    return false
  }
}

// ── .env file ─────────────────────────────────────────────────────────────────

function envFileWrite(key) {
  try {
    let content = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf-8') : ''
    if (/^ANTHROPIC_API_KEY=.*/m.test(content)) {
      content = content.replace(/^ANTHROPIC_API_KEY=.*/m, `ANTHROPIC_API_KEY=${key}`)
    } else {
      content = content.trimEnd() + `\nANTHROPIC_API_KEY=${key}\n`
    }
    writeFileSync(ENV_FILE, content, 'utf-8')
    return true
  } catch {
    return false
  }
}

// ── data/keys.json fallback ───────────────────────────────────────────────────

function keysFileRead() {
  try {
    if (!existsSync(KEYS_FILE)) return null
    const data = JSON.parse(readFileSync(KEYS_FILE, 'utf-8'))
    return data.anthropic_api_key || null
  } catch {
    return null
  }
}

function keysFileWrite(key) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    const data = existsSync(KEYS_FILE)
      ? JSON.parse(readFileSync(KEYS_FILE, 'utf-8'))
      : {}
    data.anthropic_api_key = key
    writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called once at server startup.
 * Tries to load the key from all sources and set process.env immediately.
 */
export function bootstrapApiKey() {
  // Already loaded (e.g. from .env via dotenv)
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    console.log('[KeyStore] ANTHROPIC_API_KEY loaded from environment')
    return process.env.ANTHROPIC_API_KEY.trim()
  }

  // Try macOS Keychain
  const fromKeychain = keychainRead()
  if (fromKeychain) {
    process.env.ANTHROPIC_API_KEY = fromKeychain
    console.log('[KeyStore] ANTHROPIC_API_KEY loaded from macOS Keychain')
    return fromKeychain
  }

  // Try keys.json
  const fromFile = keysFileRead()
  if (fromFile) {
    process.env.ANTHROPIC_API_KEY = fromFile
    console.log('[KeyStore] ANTHROPIC_API_KEY loaded from data/keys.json')
    return fromFile
  }

  console.log('[KeyStore] No ANTHROPIC_API_KEY found — add it via the Settings page')
  return null
}

/**
 * Save a new API key everywhere and update process.env immediately.
 * Returns { ok, keychain, envFile, keysFile }.
 */
export function setApiKey(key) {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('API key cannot be empty')

  // Hot-reload in the running process
  process.env.ANTHROPIC_API_KEY = trimmed

  const keychain = keychainWrite(trimmed)
  const envFile  = envFileWrite(trimmed)
  const keysFile = keysFileWrite(trimmed)

  console.log(`[KeyStore] API key saved — keychain:${keychain} env:${envFile} file:${keysFile}`)
  return { ok: true, keychain, envFile, keysFile }
}

/**
 * Returns masked key info for the settings UI.
 */
export function getKeyStatus() {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) return { set: false, preview: null }
  return {
    set: true,
    preview: `${key.slice(0, 10)}…${key.slice(-4)}`,
    length: key.length,
  }
}

/**
 * Clear the API key from all stores.
 */
export function clearApiKey() {
  process.env.ANTHROPIC_API_KEY = ''
  envFileWrite('')
  keysFileWrite('')
  try {
    execSync(
      `security delete-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE}" 2>/dev/null`,
      { timeout: 3000, stdio: 'pipe' }
    )
  } catch { /* ok if not found */ }
}
