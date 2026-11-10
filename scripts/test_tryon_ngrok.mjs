import fs from 'fs';
import path from 'path';

async function testNgrokTryon() {
  const ngrokUrl = 'https://gene-sorediate-lore.ngrok-free.dev';
  console.log(`[ngrok 验证] 正在向公网地址发起请求: ${ngrokUrl}`);

  const personBuf = fs.readFileSync('assets/portrait/thumbs/f098ba5f534.webp');
  const garmentBuf = fs.readFileSync('assets/thumbs/SUM-0005.webp');

  const reqBody = {
    person_image: `data:image/webp;base64,${personBuf.toString('base64')}`,
    garment_image: `data:image/webp;base64,${garmentBuf.toString('base64')}`,
    model: 'comfyui',
    size: '1024x1536',
    keep_face: true,
    lang: 'zh',
  };

  const startTime = Date.now();
  console.log(`发起 POST ${ngrokUrl}/tryon ...`);

  const resp = await fetch(`${ngrokUrl}/tryon`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify(reqBody),
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`ngrok 隧道响应状态码: ${resp.status} (耗时: ${duration}s)`);

  const json = await resp.json();
  if (json.code !== 0 || !json.data || !json.data.image) {
    console.error('响应异常:', json);
    throw new Error(json.message || '换装未成功');
  }

  const outPath = path.resolve('output/tryon_result_ngrok.png');
  const imgBase64 = json.data.image.replace(/^data:image\/[a-zA-Z0-9]+;base64,/, '');
  fs.writeFileSync(outPath, Buffer.from(imgBase64, 'base64'));

  console.log(`✅ ngrok 公网穿透换装成功！保存至: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
}

testNgrokTryon().catch(err => {
  console.error('测试出错:', err);
  process.exit(1);
});
