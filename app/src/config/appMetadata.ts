export const DEFAULT_APP_TITLE = '拍片哥女装'

export function resolveAppTitle(value?: string) {
  return value?.trim() || DEFAULT_APP_TITLE
}
