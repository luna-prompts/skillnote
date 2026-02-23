import JSZip from 'jszip'
import { mockSkills } from './mock-data'
import { generateMarkdown, triggerDownload } from './markdown-utils'

export async function exportAllAsZip() {
  const zip = new JSZip()
  const folder = zip.folder('skills')!
  for (const skill of mockSkills) {
    const md = generateMarkdown(skill)
    folder.file(`${skill.slug}.md`, md)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const date = new Date().toISOString().split('T')[0]
  const filename = `skillnote-export-${date}.zip`
  triggerDownload(blob, filename)
  return filename
}
