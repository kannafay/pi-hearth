import { invoke } from '@tauri-apps/api/core'
import type { ProxySettings, ProxyTestResult } from './generated/pi'

export const defaultProxySettings: ProxySettings = {
  mode: 'inherit',
  url: '',
  noProxy: 'localhost,127.0.0.1,[::1]',
}

export const testProxyConnection = (proxy: ProxySettings, target: string) =>
  invoke<ProxyTestResult>('network_test_proxy', { proxy, target })

export function validateProxy(proxy: ProxySettings) {
  if (proxy.mode !== 'manual') return ''
  try {
    const url = new URL(proxy.url.trim())
    if (
      !['http:', 'https:', 'socks5:', 'socks5h:', 'socks:'].includes(url.protocol) ||
      !url.hostname ||
      url.port === '0' ||
      !['', '/'].includes(url.pathname) ||
      url.search ||
      url.hash ||
      /\s/.test(proxy.url.trim())
    )
      return '请输入有效的 HTTP、HTTPS 或 SOCKS5 代理地址。'
    return ''
  } catch {
    return '请输入完整的代理地址，例如 http://127.0.0.1:7890。'
  }
}
