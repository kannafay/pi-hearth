import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

const certificate = path.resolve('tests/fixtures/network/localhost-cert.pem')
const tls = {
  cert: await readFile(certificate),
  key: await readFile('tests/fixtures/network/localhost-key.pem'),
}
const runtimeEntrypoint = path.resolve(
  'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js',
)
const dispatcher = path.resolve(
  'node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js',
)

async function listen(t, server) {
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  })
  return server.address().port
}

async function read(socket, count) {
  let chunk
  while ((chunk = socket.read(count)) === null) await once(socket, 'readable')
  return chunk
}

async function proxy(t, kind, destination, authenticate = true) {
  const requests = []
  if (kind !== 'socks5') {
    const server = kind === 'https' ? https.createServer(tls) : http.createServer()
    server.on('connect', (request, socket, head) => {
      requests.push(request.url)
      assert.equal(
        request.headers['proxy-authorization'],
        `Basic ${Buffer.from('proxy-user:proxy-pass').toString('base64')}`,
      )
      if (!authenticate) {
        socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n')
        return
      }
      const upstream = net.connect(destination, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        socket.pipe(upstream).pipe(socket)
      })
      upstream.on('error', () => socket.destroy())
      socket.on('close', () => upstream.destroy())
    })
    const port = await listen(t, server)
    return { url: `${kind}://proxy-user:proxy-pass@127.0.0.1:${port}`, requests }
  }
  const server = net.createServer((socket) => {
    void (async () => {
      const greeting = await read(socket, 2)
      assert.equal(greeting[0], 5)
      assert.ok((await read(socket, greeting[1])).includes(2))
      socket.write(Buffer.from([5, 2]))
      const auth = await read(socket, 2)
      assert.equal(auth[0], 1)
      assert.equal((await read(socket, auth[1])).toString(), 'proxy-user')
      const passwordLength = (await read(socket, 1))[0]
      assert.equal((await read(socket, passwordLength)).toString(), 'proxy-pass')
      socket.write(Buffer.from([1, authenticate ? 0 : 1]))
      if (!authenticate) {
        socket.end()
        return
      }
      const connect = await read(socket, 4)
      assert.deepEqual([...connect], [5, 1, 0, 3])
      const hostLength = (await read(socket, 1))[0]
      const host = (await read(socket, hostLength)).toString()
      const port = (await read(socket, 2)).readUInt16BE()
      requests.push(`${host}:${port}`)
      assert.equal(host, 'proxy-only.invalid', 'DNS must be resolved at the SOCKS5 proxy')
      const upstream = net.connect(destination, '127.0.0.1', () => {
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
        socket.pipe(upstream).pipe(socket)
      })
      upstream.on('error', () => socket.destroy())
      socket.on('close', () => upstream.destroy())
    })().catch((error) => {
      socket.destroy(error)
    })
  })
  const port = await listen(t, server)
  return { url: `socks5://proxy-user:proxy-pass@127.0.0.1:${port}`, requests }
}

function environment(url, noProxy = '', trusted = true) {
  return {
    ...process.env,
    HTTP_PROXY: url,
    http_proxy: url,
    HTTPS_PROXY: url,
    https_proxy: url,
    ALL_PROXY: url,
    all_proxy: url,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    NODE_EXTRA_CA_CERTS: trusted ? certificate : '',
    PI_TELEMETRY: '0',
  }
}

async function probe(target, env) {
  const child = spawn(process.execPath, ['runtime/network-test.mjs', dispatcher], {
    env,
    windowsHide: true,
  })
  let output = ''
  let errors = ''
  child.stdout.on('data', (data) => {
    output += data
  })
  child.stderr.on('data', (data) => {
    errors += data
  })
  child.stdin.end(JSON.stringify({ target }))
  const kill = setTimeout(() => child.kill(), 15_000)
  const [code] = await once(child, 'exit')
  clearTimeout(kill)
  assert.equal(code, 0, errors)
  return JSON.parse(output)
}

for (const [kind, secure] of [
  ['http', false],
  ['http', true],
  ['https', true],
  ['socks5', false],
  ['socks5', true],
]) {
  test(
    `${kind} proxy supports ${secure ? 'HTTPS' : 'HTTP'} targets and authentication without leaking proxy credentials`,
    { timeout: 20_000 },
    async (t) => {
      let reached = 0
      const serve = (request, response) => {
        reached++
        assert.equal(request.headers['proxy-authorization'], undefined)
        response.writeHead(204).end()
      }
      const origin = secure ? https.createServer(tls, serve) : http.createServer(serve)
      const port = await listen(t, origin)
      const route = await proxy(t, kind, port)
      const result = await probe(
        `${secure ? 'https' : 'http'}://proxy-only.invalid:${port}/ping`,
        environment(route.url),
      )
      assert.equal(result.success, true, result.error)
      assert.equal(result.status, 204)
      assert.equal(reached, 1)
      assert.ok(route.requests.length >= 1)
    },
  )
}

test(
  'localhost bypass stays direct even when the configured proxy is unavailable',
  { timeout: 20_000 },
  async (t) => {
    const port = await listen(
      t,
      http.createServer((_request, response) => response.writeHead(204).end()),
    )
    const result = await probe(
      `http://127.0.0.1:${port}/ping`,
      environment('http://127.0.0.1:1', 'localhost,127.0.0.1,[::1]'),
    )
    assert.equal(result.success, true, result.error)
    assert.equal(result.status, 204)
  },
)

test(
  'an unavailable proxy fails without silently making a direct request',
  { timeout: 20_000 },
  async (t) => {
    let reached = 0
    const port = await listen(
      t,
      http.createServer((_request, response) => {
        reached++
        response.end()
      }),
    )
    const result = await probe(`http://127.0.0.1:${port}/ping`, environment('http://127.0.0.1:1'))
    assert.equal(result.success, false)
    assert.equal(reached, 0)
  },
)

test(
  'SOCKS5 authentication failure is friendly and keeps credentials out of diagnostics',
  { timeout: 20_000 },
  async (t) => {
    const route = await proxy(t, 'socks5', 1, false)
    const result = await probe('https://proxy-only.invalid/ping', environment(route.url))
    assert.equal(result.success, false)
    assert.match(result.error, /认证失败/)
    assert.ok(!JSON.stringify(result).includes('proxy-pass'))
  },
)

test('HTTPS certificates are verified through the proxy', { timeout: 20_000 }, async (t) => {
  const port = await listen(
    t,
    https.createServer(tls, (_request, response) => response.end()),
  )
  const route = await proxy(t, 'http', port)
  const result = await probe(
    `https://proxy-only.invalid:${port}/ping`,
    environment(route.url, '', false),
  )
  assert.equal(result.success, false)
  assert.match(result.error, /证书验证失败/)
})

for (const kind of ['http', 'socks5']) {
  test(`real Pi model streaming uses the ${kind} proxy`, { timeout: 20_000 }, async (t) => {
    let reached = 0
    const port = await listen(
      t,
      https.createServer(tls, (request, response) => {
        reached++
        assert.equal(request.headers['proxy-authorization'], undefined)
        request.resume()
        request.on('end', () => {
          response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' })
          const chunk = {
            id: 'offline',
            object: 'chat.completion.chunk',
            model: 'offline',
            choices: [
              { index: 0, delta: { role: 'assistant', content: 'pong' }, finish_reason: null },
            ],
          }
          const end = {
            ...chunk,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
          }
          response.end(
            `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`,
          )
        })
      }),
    )
    const route = await proxy(t, kind, port)
    const base = path.resolve('work/network-rpc-tests')
    await mkdir(base, { recursive: true })
    const root = await mkdtemp(path.join(base, 'case-'))
    await writeFile(
      path.join(root, 'models.json'),
      JSON.stringify({
        providers: {
          'proxy-test': {
            api: 'openai-completions',
            baseUrl: `https://proxy-only.invalid:${port}/v1`,
            apiKey: 'offline-test-key',
            models: [
              {
                id: 'offline',
                name: 'Offline',
                contextWindow: 128000,
                maxTokens: 1024,
                input: ['text'],
              },
            ],
          },
        },
      }),
    )
    await writeFile(
      path.join(root, 'settings.json'),
      JSON.stringify({
        defaultProvider: 'proxy-test',
        defaultModel: 'offline',
        retry: { enabled: false },
      }),
    )
    const child = spawn(
      process.execPath,
      [
        runtimeEntrypoint,
        '--mode',
        'rpc',
        '--offline',
        '--no-extensions',
        '--no-mcp',
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        '--session-dir',
        path.join(root, 'sessions'),
      ],
      {
        cwd: root,
        env: { ...environment(route.url), PI_CODING_AGENT_DIR: root },
        windowsHide: true,
      },
    )
    t.after(() => child.kill())
    const frames = []
    let diagnostics = ''
    child.stderr.on('data', (data) => {
      diagnostics += data
    })
    const settled = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Pi did not finish: ${diagnostics}\n${JSON.stringify(frames)}`)),
        12_000,
      )
      createInterface({ input: child.stdout }).on('line', (line) => {
        const frame = JSON.parse(line)
        frames.push(frame)
        if (frame.type === 'agent_settled') {
          clearTimeout(timer)
          resolve()
        }
      })
    })
    child.stdin.write(
      JSON.stringify({ id: 'prompt', type: 'prompt', message: 'Reply with pong.' }) + '\n',
    )
    await settled
    assert.ok(
      frames.some(
        (frame) =>
          frame.type === 'message_end' &&
          frame.message?.role === 'assistant' &&
          frame.message.content.some((block) => block.text === 'pong'),
      ),
      JSON.stringify(frames),
    )
    assert.equal(reached, 1)
    assert.ok(route.requests.length >= 1)
  })
}
