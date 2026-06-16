const VAC_API = 'http://localhost:8787'

async function checkStatus() {
  try {
    const res = await fetch(`${VAC_API}/api/health`, { signal: AbortSignal.timeout(3000) })
    const data = await res.json()

    document.getElementById('api-dot').className   = 'dot ok'
    document.getElementById('api-label').textContent = 'VAC is running'
    document.getElementById('api-sub').textContent  = `AI: ${data.provider || 'unknown'}`

    // Get phone URL from health response
    const phoneUrl = `http://${data.localIp || '—'}:5173`
    document.getElementById('phone-url').textContent = phoneUrl

  } catch {
    document.getElementById('api-dot').className   = 'dot err'
    document.getElementById('api-label').textContent = 'VAC offline'
    document.getElementById('api-sub').textContent  = 'Start VAC on your Mac first'
    document.getElementById('phone-url').textContent = 'N/A — VAC not running'
  }
}

checkStatus()
