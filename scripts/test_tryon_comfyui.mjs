import fs from 'fs';
import path from 'path';

async function testSingleTryon(item) {
  console.log(`\n========================================`);
  console.log(`[测试] 模特: ${item.modelId} (${item.modelDesc}) + 服装: ${item.clothId} (${item.clothDesc})`);
  console.log(`========================================`);

  const personBuf = fs.readFileSync(item.personPath);
  const garmentBuf = fs.readFileSync(item.garmentPath);

  const personB64 = `data:image/webp;base64,${personBuf.toString('base64')}`;
  const garmentB64 = `data:image/webp;base64,${garmentBuf.toString('base64')}`;

  const reqBody = {
    person_image: personB64,
    garment_image: garmentB64,
    model: 'comfyui',
    size: '1024x1536',
    keep_face: true,
    lang: 'zh',
  };

  const startTime = Date.now();
  console.log(`正在向后端 http://127.0.0.1:8000/tryon 发起换装请求...`);

  const resp = await fetch('http://127.0.0.1:8000/tryon', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': 'http://127.0.0.1:8080',
    },
    body: JSON.stringify(reqBody),
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`HTTP 响应状态码: ${resp.status} (耗时: ${duration}s)`);

  const json = await resp.json();
  if (json.code !== 0 || !json.data || !json.data.image) {
    console.error(`换装失败:`, json);
    throw new Error(json.message || '生成失败');
  }

  const outDir = path.resolve('output');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, item.outputName);
  const imgBase64 = json.data.image.replace(/^data:image\/[a-zA-Z0-9]+;base64,/, '');
  fs.writeFileSync(outPath, Buffer.from(imgBase64, 'base64'));

  console.log(`✅ 成功生成换装效果图: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
  console.log(`使用的模型: ${json.data.model}`);
  return outPath;
}

async function main() {
  const tests = [
    {
      modelId: 'f098ba5f534',
      modelDesc: '短发模特 (整体造型)',
      personPath: 'assets/portrait/thumbs/f098ba5f534.webp',
      clothId: 'SUM-0005',
      clothDesc: '夏装碎花清凉连衣裙',
      garmentPath: 'assets/thumbs/SUM-0005.webp',
      outputName: 'tryon_result_1.png',
    },
    {
      modelId: 'f030348477b',
      modelDesc: '气质中发模特 (整体造型)',
      personPath: 'assets/portrait/thumbs/f030348477b.webp',
      clothId: 'PTY-0001',
      clothDesc: '红丝绒宴会吊带礼服短裙',
      garmentPath: 'assets/thumbs/PTY-0001.webp',
      outputName: 'tryon_result_2.png',
    },
    {
      modelId: 'f04547b94cd',
      modelDesc: '知性长发模特 (整体造型)',
      personPath: 'assets/portrait/thumbs/f04547b94cd.webp',
      clothId: 'AUT-0008',
      clothDesc: '秋季橄榄绿针织+象牙白半裙+羊毛呢大衣',
      garmentPath: 'assets/thumbs/AUT-0008.webp',
      outputName: 'tryon_result_3.png',
    },
  ];

  for (const item of tests) {
    await testSingleTryon(item);
  }
}

main().catch(err => {
  console.error('测试运行异常:', err);
  process.exit(1);
});
