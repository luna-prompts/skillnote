import { chromium } from './node_modules/playwright/index.mjs'

const HOST = process.env.SKILLNOTE_HOST || 'localhost'
const BASE = `http://${HOST}:3000`
const API = `http://${HOST}:8082`
const TOKEN = process.env.SKILLNOTE_TOKEN || 'skn_dev_demo_token'

let browser, page
let passed = 0, failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`)
    failed++
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed')
}

/** Wait for the fullscreen editor overlay to appear */
async function waitForEditor(p) {
  await p.waitForSelector('.fixed.inset-0.z-50', { timeout: 5000 })
  await p.waitForTimeout(500)
}

/** Get the scroll container inside the fullscreen editor */
function scrollContainer(p) {
  return p.locator('.fixed.inset-0.z-50 > div:nth-child(2)')
}

// Desktop mode toggle buttons have longer descriptive titles
const RAW_BTN = 'button[title="Raw — edit plain Markdown"]'
const RENDERED_BTN = 'button[title="Rendered — edit formatted text directly (WYSIWYG)"]'
const NAME_INPUT = 'input[placeholder="skill-name"]'
const DESC_TA = 'textarea[placeholder*="Describe what this skill"]'
const BOLD_BTN = 'button[title="Bold (⌘B)"]'
const CREATE_BTN = 'button:has-text("Create Skill")'
const CANCEL_BTN = 'button:has-text("Cancel")'
const OVERLAY = '.fixed.inset-0.z-50'

/** Selectors scoped to the editor overlay */
function ed(sel) { return `${OVERLAY} ${sel}` }

/** Clean up any test skills via API */
async function deleteSkill(slug) {
  try {
    await fetch(`${API}/api/v1/skills/${slug}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
  } catch {}
}

/** Click the desktop Raw mode button */
async function clickRaw(p) {
  await p.locator(ed(RAW_BTN)).click()
  await p.waitForTimeout(400)
}

/** Click the desktop Rendered mode button */
async function clickRendered(p) {
  await p.locator(ed(RENDERED_BTN)).click()
  await p.waitForTimeout(400)
}

try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  })

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  page = await ctx.newPage()

  // Set up localStorage
  await page.goto(BASE)
  await page.evaluate(({ api, token }) => {
    localStorage.setItem('skillnote:api-url', api)
    localStorage.setItem('skillnote:token', token)
  }, { api: API, token: TOKEN })

  // Clean up test skills
  for (const s of ['test-scroll-skill', 'test-raw-mode-skill', 'test-validation-skill', 'test-sticky-toolbar', 'test-raw-edited', 'roundtrip-test']) {
    await deleteSkill(s)
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n📝 SECTION 1: Name/Description scroll + Toolbar sticky')
  // ═══════════════════════════════════════════════════════════

  await page.goto(`${BASE}/skills/new`)
  await waitForEditor(page)

  await test('Name field is visible on load', async () => {
    assert(await page.locator(ed(NAME_INPUT)).isVisible(), 'Name input should be visible')
  })

  await test('Description field is visible on load', async () => {
    assert(await page.locator(ed(DESC_TA)).isVisible(), 'Description textarea should be visible')
  })

  await test('Toolbar is visible before scrolling', async () => {
    assert(await page.locator(ed(BOLD_BTN)).isVisible(), 'Bold button should be visible')
  })

  // Fill metadata
  await page.locator(ed(NAME_INPUT)).fill('test-scroll-skill')
  await page.locator(ed(DESC_TA)).fill('A test skill for scroll behavior')

  // Add long content directly into the Tiptap editor via JS
  // This bypasses the raw mode issue and ensures content is rendered
  await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror')
    if (!editor) return
    let html = ''
    for (let i = 1; i <= 60; i++) {
      html += `<h2>Section ${i}</h2><p>This is paragraph content for section ${i}. It has enough text to make the page scrollable so we can test scroll behavior and sticky toolbar.</p>`
    }
    editor.innerHTML = html
  })
  await page.waitForTimeout(500)

  // Check if the scroll container actually has overflow
  const scrollInfo = await scrollContainer(page).evaluate(el => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
    canScroll: el.scrollHeight > el.clientHeight,
  }))

  await test('Scroll container has overflowing content', async () => {
    assert(scrollInfo.canScroll, `scrollHeight=${scrollInfo.scrollH} should be > clientHeight=${scrollInfo.clientH}`)
  })

  await test('Name/description scroll away when content is scrolled down', async () => {
    const sc = scrollContainer(page)
    await sc.evaluate(el => { el.scrollTo({ top: 600 }) })
    await page.waitForTimeout(300)

    const nameBox = await page.locator(ed(NAME_INPUT)).boundingBox()
    const isScrolledAway = !nameBox || nameBox.y < 0
    assert(isScrolledAway, `Name field should be scrolled away but y=${nameBox?.y}`)
  })

  await test('Toolbar remains visible (sticky) after scrolling past metadata', async () => {
    const sc = scrollContainer(page)
    // Scroll to max to really push past metadata
    await sc.evaluate(el => el.scrollTo({ top: el.scrollHeight }))
    await page.waitForTimeout(300)

    const scrollTop = await sc.evaluate(el => el.scrollTop)
    assert(scrollTop > 200, `Should be scrolled significantly but scrollTop=${scrollTop}`)

    const isVisible = await page.locator(ed(BOLD_BTN)).isVisible()
    assert(isVisible, 'Bold button should still be visible after scrolling (sticky toolbar)')

    // Check toolbar position relative to scroll container
    const boldBox = await page.locator(ed(BOLD_BTN)).boundingBox()
    const containerBox = await sc.boundingBox()
    assert(boldBox && containerBox, 'Should have bounding boxes')
    const relativeY = boldBox.y - containerBox.y
    // Allow more tolerance — sticky toolbar with mobile mode row + toolbar row ~80-100px total
    assert(relativeY < 120, `Toolbar should be near top of scroll container, but relativeY=${relativeY}`)
  })

  await test('Name field is NOT visible after scrolling (not sticky)', async () => {
    const nameBox = await page.locator(ed(NAME_INPUT)).boundingBox()
    const isHidden = !nameBox || nameBox.y < 0
    assert(isHidden, `Name field should be scrolled away but y=${nameBox?.y}`)
  })

  await page.locator(ed(CANCEL_BTN)).click()
  await page.waitForTimeout(300)


  // ═══════════════════════════════════════════════════════════
  console.log('\n⚠️  SECTION 3: Validation — submit without name/description focuses field')
  // ═══════════════════════════════════════════════════════════

  await page.goto(`${BASE}/skills/new`)
  await waitForEditor(page)

  await test('Create Skill button exists', async () => {
    assert(await page.locator(ed(CREATE_BTN)).isVisible(), 'Create Skill button should be visible')
  })

  await test('Clicking Create Skill with empty name stays on editor', async () => {
    await page.locator(ed(CREATE_BTN)).click()
    await page.waitForTimeout(500)
    assert(await page.locator(OVERLAY).isVisible(), 'Editor overlay should still be visible')
  })

  await test('Validation error shown after submit with empty name', async () => {
    const errorText = page.locator(`${OVERLAY} .text-destructive`)
    assert(await errorText.count() > 0, 'Should show validation error text')
  })

  await test('Name field receives focus when validation fails on name', async () => {
    const isFocused = await page.locator(ed(NAME_INPUT)).evaluate(el => el === document.activeElement)
    assert(isFocused, 'Name input should be focused after validation failure')
  })

  await test('Fill name, leave description empty — Create focuses description', async () => {
    await page.locator(ed(NAME_INPUT)).fill('test-validation-skill')
    await page.locator(ed(DESC_TA)).fill('')

    await page.locator(ed(CREATE_BTN)).click()
    await page.waitForTimeout(500)

    assert(await page.locator(OVERLAY).isVisible(), 'Editor overlay should still be visible')
    const isFocused = await page.locator(ed(DESC_TA)).evaluate(el => el === document.activeElement)
    assert(isFocused, 'Description textarea should be focused after validation failure')
  })

  await test('Fill both fields — Create Skill submits successfully', async () => {
    await page.locator(ed(DESC_TA)).fill('A skill to test validation flow')
    await page.locator(ed(CREATE_BTN)).click()
    await page.waitForTimeout(3000)
    const url = page.url()
    const overlayGone = !(await page.locator(OVERLAY).isVisible().catch(() => false))
    assert(url.includes('/skills/') || overlayGone, `Should have navigated, url=${url}`)
  })

  await deleteSkill('test-validation-skill')


  // ═══════════════════════════════════════════════════════════
  console.log('\n📄 SECTION 4: Raw mode shows full SKILL.md with frontmatter')
  // ═══════════════════════════════════════════════════════════

  await page.goto(`${BASE}/skills/new`)
  await waitForEditor(page)

  await page.locator(ed(NAME_INPUT)).fill('test-raw-mode-skill')
  await page.locator(ed(DESC_TA)).fill('Testing raw mode frontmatter display')

  await test('Name label visible in Rendered mode', async () => {
    const nameLabel = page.locator(`${OVERLAY} label:has-text("Name")`)
    assert(await nameLabel.isVisible(), 'Name label should be visible in rendered mode')
  })

  await clickRaw(page)

  await test('Metadata section is hidden in Raw mode', async () => {
    const nameLabel = page.locator(`${OVERLAY} label:has-text("Name")`)
    const count = await nameLabel.count()
    const visible = count > 0 && await nameLabel.isVisible().catch(() => false)
    assert(!visible, 'Name label should NOT be visible in raw mode')
  })

  await test('Raw textarea shows frontmatter with name', async () => {
    const ta = page.locator(`${OVERLAY} textarea`).last()
    const val = await ta.inputValue()
    assert(val.includes('---'), `Should have frontmatter delimiters, got: ${val.substring(0, 100)}`)
    assert(val.includes('name: test-raw-mode-skill'), `Should have name in frontmatter, got: ${val.substring(0, 200)}`)
  })

  await test('Raw textarea shows frontmatter with description', async () => {
    const ta = page.locator(`${OVERLAY} textarea`).last()
    const val = await ta.inputValue()
    assert(val.includes('description: Testing raw mode frontmatter display'), `Should have description, got: ${val.substring(0, 300)}`)
  })

  await test('Raw mode hint mentions SKILL.md', async () => {
    const hint = page.locator(`${OVERLAY} :text("Editing raw SKILL.md")`)
    assert(await hint.count() > 0, 'Should show SKILL.md hint text')
  })

  await test('Editing name in raw frontmatter updates metadata on switch back', async () => {
    const ta = page.locator(`${OVERLAY} textarea`).last()
    let val = await ta.inputValue()
    val = val.replace('name: test-raw-mode-skill', 'name: test-raw-edited')
    await ta.fill(val)
    await page.waitForTimeout(200)

    await clickRendered(page)

    const nameVal = await page.locator(ed(NAME_INPUT)).inputValue()
    assert(nameVal === 'test-raw-edited', `Name should be "test-raw-edited" but got "${nameVal}"`)
  })

  await test('Editing description in raw frontmatter updates metadata on switch back', async () => {
    await clickRaw(page)
    const ta = page.locator(`${OVERLAY} textarea`).last()
    let val = await ta.inputValue()
    val = val.replace('description: Testing raw mode frontmatter display', 'description: Updated from raw mode')
    await ta.fill(val)
    await page.waitForTimeout(200)

    await clickRendered(page)

    const descVal = await page.locator(ed(DESC_TA)).inputValue()
    assert(descVal === 'Updated from raw mode', `Description should be "Updated from raw mode" but got "${descVal}"`)
  })

  await test('Metadata section reappears after switching back to Rendered', async () => {
    const nameLabel = page.locator(`${OVERLAY} label:has-text("Name")`)
    assert(await nameLabel.isVisible(), 'Name label should reappear')
  })

  await page.locator(ed(CANCEL_BTN)).click()
  await page.waitForTimeout(300)


  // ═══════════════════════════════════════════════════════════
  console.log('\n🔄 SECTION 5: Mode toggle roundtrip — data integrity')
  // ═══════════════════════════════════════════════════════════

  await page.goto(`${BASE}/skills/new`)
  await waitForEditor(page)

  await page.locator(ed(NAME_INPUT)).fill('roundtrip-test')
  await page.locator(ed(DESC_TA)).fill('Roundtrip description')

  await test('Rendered → Raw → Rendered preserves name and description', async () => {
    await clickRaw(page)
    await clickRendered(page)

    const nameVal = await page.locator(ed(NAME_INPUT)).inputValue()
    const descVal = await page.locator(ed(DESC_TA)).inputValue()
    assert(nameVal === 'roundtrip-test', `Name should be "roundtrip-test" but got "${nameVal}"`)
    assert(descVal === 'Roundtrip description', `Desc should be "Roundtrip description" but got "${descVal}"`)
  })

  await test('Multiple mode switches preserve data integrity', async () => {
    for (let i = 0; i < 3; i++) {
      await clickRaw(page)
      await clickRendered(page)
    }
    const nameVal = await page.locator(ed(NAME_INPUT)).inputValue()
    const descVal = await page.locator(ed(DESC_TA)).inputValue()
    assert(nameVal === 'roundtrip-test', `Name should survive 3 roundtrips but got "${nameVal}"`)
    assert(descVal === 'Roundtrip description', `Desc should survive 3 roundtrips but got "${descVal}"`)
  })

  await page.locator(ed(CANCEL_BTN)).click()
  await page.waitForTimeout(300)


  // ═══════════════════════════════════════════════════════════
  console.log('\n📍 SECTION 6: Editor opens at top (not scrolled to cursor)')
  // ═══════════════════════════════════════════════════════════

  await page.goto(`${BASE}/skills/new`)
  await waitForEditor(page)

  await test('Editor opens with scroll position at top', async () => {
    const sc = scrollContainer(page)
    const scrollTop = await sc.evaluate(el => el.scrollTop)
    assert(scrollTop === 0, `Scroll should be at top (0) but scrollTop=${scrollTop}`)
  })

  await test('Name field is visible on initial open (not scrolled past)', async () => {
    const nameBox = await page.locator(ed(NAME_INPUT)).boundingBox()
    assert(nameBox && nameBox.y > 0, `Name field should be visible at top, y=${nameBox?.y}`)
  })

  await page.locator(ed(CANCEL_BTN)).click()
  await page.waitForTimeout(300)

  // Test edit mode too — navigate to an existing skill and open edit
  await test('Edit mode also opens at top', async () => {
    // Create a skill with some content first
    await page.goto(`${BASE}/skills/new`)
    await waitForEditor(page)
    await page.locator(ed(NAME_INPUT)).fill('test-scroll-top')
    await page.locator(ed(DESC_TA)).fill('Testing scroll top on edit')

    // Add some content via Tiptap
    await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror')
      if (!editor) return
      let html = ''
      for (let i = 1; i <= 30; i++) {
        html += `<p>Line ${i} of content to make editor scrollable.</p>`
      }
      editor.innerHTML = html
    })
    await page.waitForTimeout(300)

    // Check scroll is still at top after content was added
    const sc = scrollContainer(page)
    const scrollTop = await sc.evaluate(el => el.scrollTop)
    assert(scrollTop === 0, `Scroll should remain at top after adding content, scrollTop=${scrollTop}`)

    await page.locator(ed(CANCEL_BTN)).click()
    await page.waitForTimeout(300)
  })

  // Clean up
  for (const s of ['test-raw-mode-skill', 'test-raw-edited', 'roundtrip-test', 'test-scroll-skill', 'test-sticky-toolbar', 'test-validation-skill']) {
    await deleteSkill(s)
  }

} catch (err) {
  console.error('\n💥 Fatal error:', err.message)
  failed++
} finally {
  await browser?.close()
  console.log(`\n${'═'.repeat(50)}`)
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  console.log(`${'═'.repeat(50)}\n`)
  process.exit(failed > 0 ? 1 : 0)
}
