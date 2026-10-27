const failures = [
  {
    pattern: /unsupported[_ -](?:country|region)|(?:country|region|location).{0,40}not supported/i,
    message: '模型服务在当前地区暂不可用，请确认服务的地区限制。',
    hint: '请检查服务支持的地区，以及当前网络或代理出口的可用性。',
  },
  {
    pattern:
      /\b(?:401|403)\b|invalid.{0,12}api.?key|api.?key.{0,20}not valid|unauthori[sz]ed|authentication failed|permission denied/i,
    message: '模型服务验证失败，请检查凭证和访问权限。',
    hint: '请检查当前模型的 API Key、服务地址及访问权限。',
  },
  {
    pattern: /\b404\b|\b(?:model[_ -])?not[_ -]found\b/i,
    message: '未找到模型或接口，请检查模型名称和服务地址。',
    hint: '请核对模型 ID、服务地址和 API 版本路径是否正确。',
  },
  {
    pattern: /\b429\b|rate[_ -]?limit|too many requests|resource[_ -]exhausted|quota.{0,20}exceed/i,
    message: '模型服务暂时受限，请稍后重试或检查配额。',
    hint: '请求频率限制或账户额度不足都可能导致此错误。',
  },
  {
    pattern:
      /context[_ -]length[_ -]exceeded|maximum context length|prompt.{0,15}too long|too many tokens/i,
    message: '对话内容超出模型限制，请压缩上下文或新建对话后重试。',
    hint: '当前对话或附件内容可能超过模型的上下文容量。',
  },
  {
    pattern: /timeout|timed?\s*out|ETIMEDOUT|deadline exceeded|\b(?:408|504)\b|请求超时/i,
    message: '请求超时，请稍后重试。',
    hint: '未在规定时间内收到模型服务的响应，可能与网络、代理连接或服务繁忙有关。',
  },
  {
    pattern:
      /fetch failed|failed to fetch|network(?:error| request failed)|ECONN(?:RESET|REFUSED|ABORTED)|E(?:AI_AGAIN|NOTFOUND|HOSTUNREACH|NETUNREACH)|socket hang up|connection.{0,12}(?:closed|reset|refused)/i,
    message: '连接模型服务失败，请检查网络或代理后重试。',
    hint: '可能与网络连接、代理配置或服务在当前地区的可用性有关。',
  },
  {
    pattern: /\b(?:500|502|503)\b|internal server error|service unavailable|overloaded/i,
    message: '模型服务暂时不可用，请稍后重试。',
    hint: '服务可能正在维护或繁忙，请稍后再试。',
  },
]

export function describeResponseError(error: string) {
  const failure = failures.find(({ pattern }) => pattern.test(error))
  return failure ? { message: failure.message, hint: failure.hint } : null
}
