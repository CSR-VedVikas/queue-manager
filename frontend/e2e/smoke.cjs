// End-to-end check of every requirement in the brief, in a real browser.
//
//   npm install --no-save playwright && npx playwright install chromium
//   APP_URL=http://localhost:5173 node e2e/smoke.cjs
//
// Needs the frontend and backend running. Creates a fresh account each run.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')

const APP = process.env.APP_URL ?? 'http://localhost:5173'

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  const waitingNames = async () =>
    (await page.locator('ol > li span.truncate').allInnerTexts()).map((s) => s.trim())

  const step = (name) => console.log(`✓ ${name}`)

  // 1. Manager signs up (and is therefore logged in)
  await page.goto(`${APP}/signup`)
  await page.fill('#name', 'E2E Manager')
  await page.fill('#email', `e2e-${Date.now()}@example.com`)
  await page.fill('#password', 'password123')
  await page.click('button:has-text("Create account")')
  await page.waitForURL('**/queues')
  step('sign up and land on queues')

  // 1-2. Create a named queue
  await page.fill('#queue-name', 'Billing counter')
  await page.click('button:has-text("Create queue")')
  await page.waitForURL(/\/queues\/\d+$/)
  await page.getByRole('heading', { name: 'Billing counter' }).waitFor()
  step('create a named queue')

  // 3-4. Add people; tokens are created and listed
  for (const name of ['Asha', 'Bilal', 'Chen']) {
    await page.fill('#token-label-desktop', name)
    await page.click('button:has-text("Issue token"):visible')
    await page.locator(`li:has-text("${name}")`).waitFor()
  }
  assert.deepEqual(await waitingNames(), ['Asha', 'Bilal', 'Chen'])
  step('add three tokens and list them')

  // 5. Move Chen up twice -> front of the line
  await page.click('button[aria-label="Move 003 up"]')
  await page.waitForFunction(() => document.querySelectorAll('ol li')[1]?.textContent?.includes('Chen'))
  await page.click('button[aria-label="Move 003 up"]')
  await page.waitForFunction(() => document.querySelectorAll('ol li')[0]?.textContent?.includes('Chen'))
  assert.deepEqual(await waitingNames(), ['Chen', 'Asha', 'Bilal'])
  assert.equal(await page.locator('button[aria-label="Move 003 up"]').isDisabled(), true)
  step('move a token up to the front (up button then disabled)')

  // 6. Serve the front of the line
  await page.click('button:has-text("Call next: 003")')
  await page.locator('section[aria-label="Now serving"]:has-text("Chen")').waitFor()
  assert.deepEqual(await waitingNames(), ['Asha', 'Bilal'])
  step('call the token at the top for service')

  // 7. Cancel a waiting token (with confirmation)
  await page.click('button[aria-label="Cancel 002"]')
  await page.click('dialog button:has-text("Cancel token")')
  await page.waitForFunction(() => !document.querySelector('ol')?.textContent?.includes('Bilal'))
  assert.deepEqual(await waitingNames(), ['Asha'])
  step('cancel a token after confirming')

  // Serve next completes Chen and calls Asha
  await page.click('button:has-text("Call next: 001")')
  await page.locator('section[aria-label="Now serving"]:has-text("Asha")').waitFor()
  await page.locator('li:has-text("Chen"):has-text("Served")').waitFor()
  step('finished tokens move to "Recently finished"')

  // Persistence: reload and the state is still there
  await page.reload()
  await page.locator('section[aria-label="Now serving"]:has-text("Asha")').waitFor()
  step('state survives a page reload')

  // 8. Dashboard shows the activity
  await page.click('nav >> text=Dashboard')
  await page.getByRole('heading', { name: 'Busiest hours' }).waitFor()
  const servedFigure = page.locator('span.text-slate', { hasText: /^Served$/ }).locator('xpath=preceding-sibling::span')
  assert.equal((await servedFigure.innerText()).trim(), '1')
  step('dashboard loads and counts the served token')

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('; ')}`)
  console.log('\nAll checks passed.')
  await browser.close()
})().catch((err) => {
  console.error('\nE2E FAILED:', err.message)
  process.exit(1)
})
