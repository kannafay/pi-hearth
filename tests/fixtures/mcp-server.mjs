import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'
const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  const request = JSON.parse(line)
  if (!('id' in request)) return
  let result
  if (request.method === 'initialize') {
    if (process.argv[2]) writeFileSync(process.argv[2], String(process.pid))
    result = {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture', version: '1' },
    }
  } else if (request.method === 'tools/list')
    result = {
      tools: [
        {
          name: 'echo',
          description: 'Echo test input',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
      ],
    }
  else if (request.method === 'tools/call')
    result = { content: [{ type: 'text', text: String(request.params.arguments.text) }] }
  else result = {}
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
})
input.on('close', () => process.exit(0))
