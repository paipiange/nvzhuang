import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// 1. 测试 data-portrait.js
const portraitJsPath = path.resolve('data-portrait.js');
assert.ok(fs.existsSync(portraitJsPath), 'data-portrait.js 必须存在');

const portraitContext = {};
vm.createContext(portraitContext);
const result = vm.runInContext(fs.readFileSync(portraitJsPath, 'utf-8') + '\n;({META_PORTRAIT, D_PORTRAIT})', portraitContext);

assert.ok(result.META_PORTRAIT, 'META_PORTRAIT 必须存在');
assert.ok(result.D_PORTRAIT, 'D_PORTRAIT 必须存在');
assert.equal(result.META_PORTRAIT.total, 1499, '模特总数必须是 1499');
assert.equal(result.D_PORTRAIT.length, 1499, '模特数组长度必须是 1499');

// 2. 测试本地 assets/portrait/thumbs 资源
const thumbsDir = path.resolve('assets/portrait/thumbs');
assert.ok(fs.existsSync(thumbsDir), 'assets/portrait/thumbs 目录必须存在');
const thumbFiles = fs.readdirSync(thumbsDir);
assert.equal(thumbFiles.length, 1499, '本地缩略图数量必须是 1499');

// 随机抽查 5 个文件的非空性
for (let i = 0; i < 5; i++) {
  const item = result.D_PORTRAIT[Math.floor(Math.random() * 1499)];
  const localFile = path.resolve('assets', item.サムネ);
  assert.ok(fs.existsSync(localFile), `本地文件 ${localFile} 必须存在`);
  assert.ok(fs.statSync(localFile).size > 500, `文件 ${localFile} 大小必须有效`);
}

// 3. 测试 index.html 注入与多语言
const html = fs.readFileSync(path.resolve('index.html'), 'utf-8');
assert.ok(html.includes('<script src="data-portrait.js"></script>'), '必须引入 data-portrait.js');
assert.ok(html.includes('data-db="portrait"'), '必须包含 portrait 图库切换按钮');
assert.ok(html.includes('id="btnOpenPortraitModal"'), '必须包含试穿台模特选择按钮');
assert.ok(html.includes('id="portraitModalOverlay"'), '必须包含模特选择弹窗浮层');

// 4. 回归测试：模特入口应与上传/预览处于同一行，弹窗卡片不能被网格压扁
assert.match(
  html,
  /<div class="step-photo-row">[\s\S]*?<div class="portrait-quick-row">[\s\S]*?id="btnOpenPortraitModal"[\s\S]*?<\/div>\s*<\/div>\s*<div class="step-compress-row">/,
  '模特选择入口必须位于照片选择行内'
);
const portraitGridRule = html.match(/\.portrait-dialog-body\{[^}]*\}/)?.[0] || '';
assert.ok(portraitGridRule.includes('align-content:start'), '模特弹窗网格必须从顶部排列');
assert.ok(portraitGridRule.includes('grid-auto-rows:max-content'), '模特弹窗卡片必须保持自然高度');

// 5. 回归测试：人脸图库状态不能污染试穿区的服装列表
assert.match(
  html,
  /let fitDb = CURRENT_DB === 'anime' \? 'anime' : 'real';/,
  '试穿区必须维护独立的服装图库状态'
);
assert.match(
  html,
  /function getFilteredGarments\(\)\{\s*return getFitD\(\)\.filter/,
  '试穿服装列表必须从服装图库读取，不能读取人脸图库'
);
assert.match(
  html,
  /window\.openFitWithPerson = \(portraitId\) => \{[\s\S]*?setFitDatabase\('real'\);[\s\S]*?open\(\);/,
  '从人脸进入试穿时必须默认切换到写实服装库'
);

console.log('✅ 所有 AI 模特图库本地化集成与页面完整性测试全部通过！');
