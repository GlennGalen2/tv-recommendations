function safeProviderMessage({ status, type, code } = {}) {
  if (code === 'credit_balance_exhausted') return 'OpenAI API credit balance is exhausted.'
  if (status === 429) return 'OpenAI provider rate limited the request.'
  if (status === 401 || status === 403) return 'OpenAI authentication or authorization failed.'
  if (type === 'response_extraction_failed') return 'OpenAI response did not contain output text.'
  return 'OpenAI provider request failed.'
}

function providerError({ status = null, type = null, code = null } = {}) {
  const error = new Error(safeProviderMessage({ status, type, code }))
  error.status = status || null
  error.type = type || null
  error.code = code || null
  return error
}

async function providerFailure(response) {
  let payload
  try { payload = await response.json() } catch {}
  return providerError({ status: response.status, type: payload?.error?.type, code: payload?.error?.code })
}

function outputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text
  for (const item of payload?.output || []) for (const content of item?.content || []) if (content?.type === 'output_text' && typeof content.text === 'string') return content.text
  return null
}

export function createOpenAiResponsesAdapter({ model, apiKey, endpoint = 'https://api.openai.com/v1/responses', fetchImpl = globalThis.fetch } = {}) {
  if (!model || !apiKey) throw new TypeError('OpenAI adapter requires model and API key.')
  return {
    id: 'openai', model,
    async evaluate({ prompt, outputSchema }) {
      let response
      try {
        response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: prompt, store: false, text: { format: { type: 'json_schema', name: 'tv_recommendation_evaluation', strict: true, schema: outputSchema } } }) })
      } catch { throw providerError() }
      if (!response.ok) throw await providerFailure(response)
      const payload = await response.json()
      const text = outputText(payload)
      if (text === null) throw providerError({ status: response.status, type: 'response_extraction_failed', code: 'missing_output_text' })
      return { text, usage: payload.usage ? { inputTokens: payload.usage.input_tokens || 0, cachedInputTokens: payload.usage.input_tokens_details?.cached_tokens || 0, outputTokens: payload.usage.output_tokens || 0, reasoningTokens: payload.usage.output_tokens_details?.reasoning_tokens || 0, totalTokens: payload.usage.total_tokens || 0 } : null }
    }
  }
}

export function createOpenAiWebResearchAdapter({ model, apiKey, endpoint = 'https://api.openai.com/v1/responses', fetchImpl = globalThis.fetch } = {}) {
  if (!model || !apiKey) throw new TypeError('OpenAI web-research adapter requires model and API key.')
  return {
    id: 'openai-web-research', model,
    async research({ prompt, outputSchema }) {
      let response
      try {
        response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: prompt, store: false, tools: [{ type: 'web_search', search_context_size: 'medium' }], tool_choice: 'required', text: { format: { type: 'json_schema', name: 'tv_candidate_research', strict: true, schema: outputSchema } } }) })
      } catch { throw providerError() }
      if (!response.ok) throw await providerFailure(response)
      const payload = await response.json()
      const text = outputText(payload)
      if (text === null) throw providerError({ status: response.status, type: 'response_extraction_failed', code: 'missing_output_text' })
      return { text, usage: payload.usage ? { inputTokens: payload.usage.input_tokens || 0, cachedInputTokens: payload.usage.input_tokens_details?.cached_tokens || 0, outputTokens: payload.usage.output_tokens || 0, reasoningTokens: payload.usage.output_tokens_details?.reasoning_tokens || 0, totalTokens: payload.usage.total_tokens || 0 } : null }
    }
  }
}

export function createOpenAiCompatibleAdapter({ model, apiKey, baseUrl, fetchImpl = globalThis.fetch } = {}) {
  if (!model || !apiKey || !baseUrl) throw new TypeError('OpenAI-compatible adapter requires model, API key, and baseUrl.')
  return {
    id: 'openai-compatible', model,
    async evaluate({ prompt, outputSchema }) {
      let response
      try {
        response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_schema', json_schema: { name: 'tv_recommendation_evaluation', strict: true, schema: outputSchema } } }) })
      } catch { throw providerError() }
      if (!response.ok) throw await providerFailure(response)
      const payload = await response.json()
      return { text: payload.choices?.[0]?.message?.content, usage: payload.usage ? { inputTokens: payload.usage.prompt_tokens || 0, outputTokens: payload.usage.completion_tokens || 0, totalTokens: payload.usage.total_tokens || 0 } : null }
    }
  }
}
