import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { ConversationLocalState } from './conversation-local-state'
import { ResponseError } from './response-error'
import { describeResponseError } from './response-error-message'

test.each([
  ['TypeError: fetch failed', '连接模型服务失败，请检查网络或代理后重试。'],
  ['ECONNRESET: socket hang up', '连接模型服务失败，请检查网络或代理后重试。'],
  ['fetch failed: UND_ERR_CONNECT_TIMEOUT', '请求超时，请稍后重试。'],
  ['Request timed out after 60000ms', '请求超时，请稍后重试。'],
  ['HTTP 504 Gateway Timeout', '请求超时，请稍后重试。'],
  [
    '403: User location is not supported for the API use.',
    '模型服务在当前地区暂不可用，请确认服务的地区限制。',
  ],
  ['HTTP 401: Invalid API key', '模型服务验证失败，请检查凭证和访问权限。'],
  ['HTTP 404 Not Found', '未找到模型或接口，请检查模型名称和服务地址。'],
  ['model_not_found', '未找到模型或接口，请检查模型名称和服务地址。'],
  [
    '{"error":{"message":"","code":4[已隐藏密钥]4,"status":"Not Found"}}',
    '未找到模型或接口，请检查模型名称和服务地址。',
  ],
  ['getaddrinfo ENOTFOUND api.example.com', '连接模型服务失败，请检查网络或代理后重试。'],
  ['429 RESOURCE_EXHAUSTED: Quota exceeded', '模型服务暂时受限，请稍后重试或检查配额。'],
  ['context_length_exceeded', '对话内容超出模型限制，请压缩上下文或新建对话后重试。'],
  ['HTTP 503 Service unavailable', '模型服务暂时不可用，请稍后重试。'],
])('summarizes %s without changing the underlying error', (error, message) => {
  expect(describeResponseError(error)?.message).toBe(message)
})

test('unrecognized application errors are left for the caller to handle', () => {
  expect(describeResponseError('无法保存配置文件。')).toBeNull()
})

test('network failures show a friendly summary and reveal the original error only on request', async () => {
  const user = userEvent.setup()
  render(<ResponseError error="TypeError: fetch failed" stateKey="failed-turn" />)
  expect(screen.getByRole('alert')).toHaveTextContent('连接模型服务失败，请检查网络或代理后重试。')
  const details = screen.getByRole('button', { name: '失败原因' })
  expect(details).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('TypeError: fetch failed')).not.toBeInTheDocument()
  await user.click(details)
  expect(screen.getByRole('region', { name: '失败原因详情' })).toBeVisible()
  expect(screen.getByText('TypeError: fetch failed')).toBeVisible()
  expect(screen.getByText(/可能与网络连接、代理配置或服务在当前地区的可用性有关/)).toBeVisible()
})

test('404 failures explain what configuration to check and preserve the status in details', async () => {
  const user = userEvent.setup()
  const error = '{"error":{"message":"","code":404,"status":"Not Found"}}'
  render(<ResponseError error={error} stateKey="missing-model-endpoint" />)
  expect(screen.getByRole('alert')).toHaveTextContent(
    '未找到模型或接口，请检查模型名称和服务地址。',
  )
  await user.click(screen.getByRole('button', { name: '失败原因' }))
  expect(screen.getByText(error)).toBeVisible()
  expect(screen.getByText('请核对模型 ID、服务地址和 API 版本路径是否正确。')).toBeVisible()
})

test('expanded failure details survive virtual row remounts and remain scoped to their turn', async () => {
  const user = userEvent.setup()
  const local = new Map<string, unknown>()
  const content = (stateKey: string) => (
    <ConversationLocalState initial={local}>
      <ResponseError error="fetch failed" stateKey={stateKey} />
    </ConversationLocalState>
  )
  let view = render(content('first'))
  await user.click(screen.getByRole('button', { name: '失败原因' }))
  view.unmount()
  view = render(content('first'))
  expect(screen.getByText('fetch failed')).toBeVisible()
  view.unmount()
  render(content('second'))
  expect(screen.getByRole('button', { name: '失败原因' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('fetch failed')).not.toBeInTheDocument()
})

test('unknown errors still retain their full original text in the details', async () => {
  const user = userEvent.setup()
  const error = 'Unexpected upstream payload\n<html>Service failed</html>'
  render(<ResponseError error={error} stateKey="unknown" />)
  expect(screen.getByRole('alert')).toHaveTextContent('本次请求未完成，请稍后重试。')
  await user.click(screen.getByRole('button', { name: '失败原因' }))
  expect(screen.getByText(/Unexpected upstream payload/).textContent).toBe(error)
  expect(document.querySelector('pre html')).not.toBeInTheDocument()
})
