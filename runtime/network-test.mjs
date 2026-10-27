import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { realpath } from 'node:fs/promises'

function failure(error) {
  const code = String(error?.cause?.code ?? error?.code ?? '')
  const message = String(error?.cause?.message ?? error?.message ?? '')
  if (/AUTH|authenticat|credentials/i.test(code + message))
    return '代理认证失败，请检查用户名和密码。'
  if (/CERT|TLS|SSL/.test(code)) return '证书验证失败，请检查代理和目标服务的证书。'
  if (/TIMEOUT|ABORT/i.test(code) || error?.name === 'TimeoutError')
    return '连接超时，请检查代理地址和网络。'
  if (/ECONNREFUSED/.test(code)) return '无法连接，请确认代理软件已启动、端口和测试地址正确。'
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return '无法解析地址，请检查代理和 DNS 设置。'
  return '连接失败，请检查代理地址、认证信息和代理服务状态。'
}

let dispatcher
try {
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
    if (input.length > 16_384) throw new Error('Invalid request')
  }
  const { target } = JSON.parse(input)
  const module = await realpath(process.argv[2])
  const { configureHttpDispatcher } = await import(pathToFileURL(module).href)
  configureHttpDispatcher(10_000)
  dispatcher = createRequire(module)('undici').getGlobalDispatcher()
  const started = performance.now()
  const response = await fetch(target, { signal: AbortSignal.timeout(10_000) })
  await response.body?.cancel()
  process.stdout.write(
    JSON.stringify({
      success: true,
      status: response.status,
      elapsedMs: Math.round(performance.now() - started),
    }),
  )
} catch (error) {
  process.stdout.write(JSON.stringify({ success: false, error: failure(error) }))
} finally {
  await dispatcher?.destroy()
}
