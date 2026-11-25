import type { Page, Route } from '@playwright/test'
import { expect, test } from '@playwright/test'

const corsHeaders = {
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  'access-control-allow-origin': '*',
  'content-type': 'application/json; charset=utf-8',
}

async function fulfillData(route: Route, data: unknown) {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: corsHeaders })
    return
  }
  await route.fulfill({
    status: 200,
    headers: corsHeaders,
    body: JSON.stringify({ code: 0, message: 'ok', data }),
  })
}

async function mockCompanionBackend(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/tryon/providers/health')) {
      await fulfillData(route, {
        generation_request_made: false,
        providers: [
          { alias: 'gemini', configured: true, reachable: true },
          { alias: 'comfyui', configured: true, reachable: false },
        ],
      })
      return
    }
    if (path.endsWith('/voice/status')) {
      await fulfillData(route, { components: [], models: [], downloading: false, download_progress: 0, message: 'ready' })
      return
    }
    if (path.endsWith('/voice/tasks')) {
      await fulfillData(route, { tasks: [], huggingface_token_configured: false, modelscope_token_configured: false, seeduplex_api_key_configured: true })
      return
    }
    if (path.endsWith('/voice/todos')) {
      await fulfillData(route, { items: [], completed: 0, total: 0, progress: 100 })
      return
    }
    await route.fulfill({ status: 404, headers: corsHeaders, body: JSON.stringify({ code: 404, message: 'not found' }) })
  })
}

test.beforeEach(async ({ page }) => {
  await mockCompanionBackend(page)
})

test('settings runs no-generation image and voice preflights', async ({ page }) => {
  await page.goto('/#/pages/mine/settings')

  await expect(page.getByTestId('settings-page')).toContainText('服务与模型设置')
  await page.getByTestId('image-provider-preflight').click()
  await expect(page.getByText(/图片模型自检完成：1\/2 个可用/)).toBeVisible()
  await expect(page.getByText(/未发起图片生成或计费请求/)).toBeVisible()

  await page.getByTestId('voice-provider-preflight').click()
  await expect(page.getByText(/语音后端自检通过，SeedDuplex Key 已配置/)).toBeVisible()
})

test('companion page switches provider and saves a local appearance preset', async ({ page }) => {
  await page.goto('/#/pages/mine/voice')

  await expect(page.getByTestId('companion-page')).toContainText('AI 陪伴通话')
  await page.getByTestId('provider-seeduplex').click()
  await expect(page.getByTestId('provider-seeduplex')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('preset-name').locator('input').fill('E2E 造型')
  await page.getByTestId('save-preset').click()
  await expect(page.getByTestId('apply-preset')).toContainText('E2E 造型')
})
