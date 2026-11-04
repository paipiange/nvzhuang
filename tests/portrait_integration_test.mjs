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

console.log('✅ 所有 AI 模特图库本地化集成与页面完整性测试全部通过！');
