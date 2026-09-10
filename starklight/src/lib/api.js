// All calls go to the SAME Express server.js the original tool used — nothing on the
// backend changed. In dev, Vite's proxy (vite.config.js) forwards /api/* to localhost:3000.

// Turns whatever the backend sent back into a real, readable string — some upstream error
// responses (Examly's own API, or a malformed proxy response) return `error`/`message` as an
// object instead of a string, and `new Error(someObject)` silently stringifies it to the
// useless "[object Object]" instead of throwing. This guarantees an actual readable message.
function asText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return String(v) }
}

function toErrorMessage(data, res) {
  const msg = asText(data?.message ?? data?.error)

  // The backend puts the UPSTREAM portal's own words under `portalMessage`,
  // and that is the only part that names the offending field. Dropping it
  // made every single rejection read "Portal rejected the save" with no way
  // to tell a schema error from an expired token.
  const portal = asText(data?.portalMessage)
  const status = data?.status ?? res.status

  let out = msg || 'Request failed'
  if (portal && portal !== msg) out += ` — ${portal}`
  if (status) out += ` (HTTP ${status})`
  return out
}

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json, text/plain, */*' }
  if (token) headers.Authorization = token
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(toErrorMessage(data, res))
    err.data = data
    throw err
  }
  return data
}

export const api = {
  // ---- Question banks ----
  searchQuestionBanks: (token, body) => request('/api/questionbanks', { method: 'POST', token, body }),
  getQuestionsForQb: (token, qbId, limit = 50) =>
    request('/api/questions', { method: 'POST', token, body: { qb_id: qbId, type: 'Single', page: 1, limit } }),

  // ---- Tests ----
  searchTests: (token, body) => request('/api/tests/filter', { method: 'POST', token, body }),
  getTestDetail: (token, testId) => request(`/api/test/${encodeURIComponent(testId)}`, { token }),
  getQuestionsForTest: (token, testId) => request(`/api/questions/test/${encodeURIComponent(testId)}`, { token }),
  createTest: (token, body) => request('/api/test', { method: 'POST', token, body }),
  updateTest: (token, testId, body) => request(`/api/test/${testId}`, { method: 'PUT', token, body }),

  // ---- AI-assisted ----
  qcAnalyze: (token, body) => request('/api/qc-analyze', { method: 'POST', token, body }),
  qcRectify: (token, body) => request('/api/qc-rectify', { method: 'POST', token, body }),
  topicAlignCheck: (token, body) => request('/api/topic-align-check', { method: 'POST', token, body }),

  // ---- Solution Forge ----
  solutionLanguages: () => request('/api/solution-languages'),
  toolchainCheck: () => request('/api/toolchain-check'),
  runTests: (body) => request('/api/run-tests', { method: 'POST', body }),
  translateSolution: (token, body) => request('/api/translate-solution', { method: 'POST', token, body }),
  fixSolution: (token, body) => request('/api/fix-solution', { method: 'POST', token, body }),
  translateFragment: (token, body) => request('/api/translate-fragment', { method: 'POST', token, body }),
  // body: { solutions: [{language, code, snippet}], bestLanguage, rawQuestion }
  // — or the single-solution form { language, code, snippet, rawQuestion }.
  pushSolution: (token, qId, body) =>
    request(`/api/question-solution/${encodeURIComponent(qId)}`, { method: 'PUT', token, body }),
  packTest: (token, body) => request('/api/pack-test', { method: 'POST', token, body }),
  matchQbsAi: (token, body) => request('/api/match-qbs-ai', { method: 'POST', token, body }),
  aptitudeDistribute: (token, body) => request('/api/aptitude-distribute', { method: 'POST', token, body })
}

export function decodeJwtPayload(token) {
  try {
    const clean = token.replace(/^Bearer\s+/i, '').trim()
    const parts = clean.split('.')
    if (parts.length < 2) return null
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    while (payload.length % 4) payload += '='
    const json = decodeURIComponent(
      atob(payload).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}
