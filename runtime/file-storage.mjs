import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export async function prepareFileStorage(event, ctx, pi, configuration) {
  if (!configuration) return
  const { directory } = JSON.parse(await readFile(configuration, 'utf8'))
  if (typeof directory !== 'string' || !path.isAbsolute(directory))
    throw new Error('文件保存位置无效，请在存储设置中重新选择。')
  const sessionId = ctx.sessionManager.getSessionId()
  if (!/^[\w-]{1,128}$/.test(sessionId)) throw new Error('无法确定当前会话的文件保存位置。')
  const uploads = path.join(directory, 'Uploads')
  const generated = path.join(directory, 'Generated', sessionId)
  await mkdir(generated, { recursive: true })
  event.systemPromptOptions.sections.hearth_file_storage = [
    `用户上传的文件保存在 ${JSON.stringify(uploads)}，请使用消息附件中的实际路径读取，不要搬动原文件。`,
    `本会话独立生成的图片、报告、导出文档等交付文件，默认保存到 ${JSON.stringify(generated)}。`,
    '项目源码、工程配置，以及完成开发任务所需的项目资源，继续在当前项目工作目录中创建或修改。',
    '独立交付文件使用上面的外部保存目录，不要因当前工作目录是代码仓库而将它们保存进项目。',
    '使用明确的输出绝对路径；保留已有文件，创建新文件时使用不同名称，并在回复中提供实际文件路径。',
  ].join('\n')
  // Retain the location with its session ID so changing the default does not
  // erase the association with artifacts produced in an earlier location.
  const previous = ctx.sessionManager
    .getEntries()
    .findLast((entry) => entry.type === 'custom' && entry.customType === 'hearth-file-storage')
  if (previous?.data?.generated !== generated)
    pi.appendEntry('hearth-file-storage', { uploads, generated })
}
