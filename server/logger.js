/**
 * VAC Structured Logger
 * Writes JSON lines to data/logs/vac.log + human-readable console output.
 * Use VAC_DEBUG=1 env var to enable debug-level output.
 */
import { createWriteStream, existsSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const LOG_DIR  = join(__dir, '../data/logs')
const LOG_FILE = join(LOG_DIR, 'vac.log')
const MAX_SIZE = 5 * 1024 * 1024 // 5 MB — rotate at this size

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })

let _stream = openStream()

function openStream() {
  return createWriteStream(LOG_FILE, { flags: 'a' })
}

function rotate() {
  try {
    _stream.end()
    renameSync(LOG_FILE, LOG_FILE + '.' + Date.now() + '.bak')
    _stream = openStream()
  } catch (_) {}
}

function write(level, component, message, meta = {}) {
  // Rotate if file is too big
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_SIZE) rotate()
  } catch (_) {}

  const entry = { ts: new Date().toISOString(), level, component, message, ...meta }
  try { _stream.write(JSON.stringify(entry) + '\n') } catch (_) {}

  // Console output
  const prefix = `[${component}]`
  const meta_str = Object.keys(meta).length
    ? ' ' + Object.entries(meta).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
    : ''

  if (level === 'error') console.error(prefix, message + meta_str)
  else if (level === 'warn')  console.warn(prefix, message + meta_str)
  else if (level === 'debug') { if (process.env.VAC_DEBUG) console.debug(prefix, message + meta_str) }
  else console.log(prefix, message + meta_str)
}

export const logger = {
  info:  (component, message, meta = {}) => write('info',  component, message, meta),
  warn:  (component, message, meta = {}) => write('warn',  component, message, meta),
  error: (component, message, meta = {}) => write('error', component, message, meta),
  debug: (component, message, meta = {}) => write('debug', component, message, meta),
}

export default logger
