import type { TabBar } from '@uni-helper/vite-plugin-uni-pages'
import type { CustomTabBarItem, NativeTabBarItem } from './types'

export const TABBAR_STRATEGY_MAP = {
  NO_TABBAR: 0,
  NATIVE_TABBAR: 1,
  CUSTOM_TABBAR: 2,
}

// 使用 CUSTOM_TABBAR 保证三端高保真还原 UI 原型
export const selectedTabbarStrategy = TABBAR_STRATEGY_MAP.CUSTOM_TABBAR

export const nativeTabbarList: NativeTabBarItem[] = [
  {
    iconPath: 'static/tabbar/home.png',
    selectedIconPath: 'static/tabbar/homeHL.png',
    pagePath: 'pages/index/index',
    text: '发现',
  },
  {
    iconPath: 'static/tabbar/example.png',
    selectedIconPath: 'static/tabbar/exampleHL.png',
    pagePath: 'pages/gallery/index',
    text: '图库',
  },
  {
    iconPath: 'static/tabbar/scan.png',
    selectedIconPath: 'static/tabbar/scan.png',
    pagePath: 'pages/tryon/index',
    text: '试衣间',
  },
  {
    iconPath: 'static/tabbar/personal.png',
    selectedIconPath: 'static/tabbar/personalHL.png',
    pagePath: 'pages/mine/index',
    text: '我的',
  },
]

export const customTabbarList: CustomTabBarItem[] = [
  {
    text: '发现',
    pagePath: 'pages/index/index',
    iconType: 'unocss',
    icon: 'i-carbon-home',
  },
  {
    text: '图库',
    pagePath: 'pages/gallery/index',
    iconType: 'unocss',
    icon: 'i-carbon-grid',
  },
  {
    text: '试衣间',
    pagePath: 'pages/tryon/index',
    iconType: 'unocss',
    icon: 'i-carbon-magic-wand',
  },
  {
    text: '我的',
    pagePath: 'pages/mine/index',
    iconType: 'unocss',
    icon: 'i-carbon-user',
  },
]

export const tabbarCacheEnable = [TABBAR_STRATEGY_MAP.NATIVE_TABBAR, TABBAR_STRATEGY_MAP.CUSTOM_TABBAR].includes(selectedTabbarStrategy)
export const customTabbarEnable = [TABBAR_STRATEGY_MAP.CUSTOM_TABBAR].includes(selectedTabbarStrategy)
export const needHideNativeTabbar = selectedTabbarStrategy === TABBAR_STRATEGY_MAP.CUSTOM_TABBAR

const _tabbarList = customTabbarEnable
  ? customTabbarList.map(item => ({ text: item.text, pagePath: item.pagePath }))
  : nativeTabbarList

export const tabbarList = customTabbarEnable ? customTabbarList : nativeTabbarList

const _tabbar: TabBar = {
  custom: selectedTabbarStrategy === TABBAR_STRATEGY_MAP.CUSTOM_TABBAR,
  color: '#A29A9D',
  selectedColor: '#CD657B',
  backgroundColor: '#FFFFFF',
  borderStyle: 'black',
  height: '56px',
  fontSize: '10px',
  iconWidth: '22px',
  spacing: '3px',
  list: _tabbarList as unknown as TabBar['list'],
}

export const tabBar = tabbarCacheEnable ? _tabbar : {}
