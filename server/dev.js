import './index.js'

// In this environment the plain Express entry can exit once startup completes,
// so we keep a lightweight interval alive for local development.
setInterval(() => {}, 1 << 30)
