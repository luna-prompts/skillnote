#!/usr/bin/env node
// Copies asset files (docker-compose template, etc.) into dist/ and substitutes
// __VERSION__ with the current package version. Run after tsup build.
import { readFile, writeFile, mkdir, readdir, cp } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const version = pkg.version

const srcDir = join(root, 'assets')
const dstDir = join(root, 'dist', 'assets')

await mkdir(dstDir, { recursive: true })

const entries = await readdir(srcDir, { withFileTypes: true })
for (const entry of entries) {
  const src = join(srcDir, entry.name)
  if (entry.name.endsWith('.tpl')) {
    const content = await readFile(src, 'utf8')
    const out = content.replaceAll('__VERSION__', version)
    const dstName = entry.name.replace(/\.tpl$/, '')
    await writeFile(join(dstDir, dstName), out)
    console.log(`✓ templated ${entry.name} → ${dstName} (version=${version})`)
  } else if (entry.isFile()) {
    await cp(src, join(dstDir, entry.name))
    console.log(`✓ copied ${entry.name}`)
  } else if (entry.isDirectory()) {
    await cp(src, join(dstDir, entry.name), { recursive: true })
    console.log(`✓ copied dir ${entry.name}/`)
  }
}

console.log(`\n✓ assets ready at dist/assets/`)
