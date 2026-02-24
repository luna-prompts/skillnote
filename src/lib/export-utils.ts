import JSZip from 'jszip'
import { generateMarkdown, triggerDownload } from './markdown-utils'
import { getSkills, syncSkillsFromApi } from './skills-store'

export async function exportAllAsZip() {
  const zip = new JSZip()
  const folder = zip.folder('skills')!
  let skills = getSkills()
  if (skills.length === 0) {
    try {
      skills = await syncSkillsFromApi()
    } catch {
      skills = []
    }
  }
  for (const skill of skills) {
    const md = generateMarkdown(skill)
    folder.file(`${skill.slug}.md`, md)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const date = new Date().toISOString().split('T')[0]
  const filename = `skillnote-export-${date}.zip`
  triggerDownload(blob, filename)
  return filename
}
