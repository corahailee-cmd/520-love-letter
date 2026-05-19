const PROMPT = `仔细观察这张照片的主色调和整体氛围，返回以下JSON（只返回JSON，不要其他文字）：
{
  "colorNameZh": "照片主色调对应的中文色名，2~4字，要求：有画面感、高级自然、带法式或日系杂志感，可结合自然/天气/花朵/光影/海洋/黄昏/森林等意象，风格参考：琥珀棕、湖蓝、晚霞紫、月光灰、雾霭青、鸢尾紫、松烟墨、海盐白",
  "colorNameEn": "对应英文色名，2~3个单词，优雅诗意",
  "hex": "照片主色调的十六进制色码",
  "letter": "根据照片氛围写一段情书文案，要求：40~80字；有留白感，不要太满；像摄影作品旁边的小诗；偏第一人称情绪；有"怦然心动""想念""陪伴""时间""光影"等意象；像在描述一个瞬间，而不是直接说"我爱你"；风格参考：「那天下午的光很长，你站在窗边没有说话，我看着你的侧脸，忽然觉得，时间可以就这样停在这里。」"
}`;

// ── DOM refs ──
const pages = {
  upload:  document.getElementById('page-upload'),
  loading: document.getElementById('page-loading'),
  result:  document.getElementById('page-result'),
};
const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const previewImg     = document.getElementById('preview-img');
const dropHolder     = document.getElementById('drop-placeholder');
const btnGenerate    = document.getElementById('btn-generate');
const btnReset       = document.getElementById('btn-reset');
const btnSave        = document.getElementById('btn-save');
const btnReselect    = document.getElementById('btn-reselect');
const btnConfirmCrop = document.getElementById('btn-confirm-crop');
const bottomActions  = document.getElementById('bottom-actions');
const uploadError    = document.getElementById('upload-error');
const resultError    = document.getElementById('result-error');
const saveHint       = document.getElementById('save-hint');

let currentBase64 = null;      // 压缩后的 base64，仅用于 API 调用
let currentOriginalUrl = null; // 裁剪后的 dataURL，用于卡片展示
let cropper = null;            // Cropper.js 实例

// ── 页面切换 ──
function showPage(name) {
  Object.values(pages).forEach(p => p.classList.remove('active'));
  pages[name].classList.add('active');
}

// ── 上传 ──
dropZone.addEventListener('click', () => {
  if (!cropper) fileInput.click();
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showUploadError('请上传图片文件');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showUploadError('图片过大，请选择 20MB 以内的图片');
    return;
  }
  hideUploadError();

  const reader = new FileReader();
  reader.onload = e => {
    // 销毁旧 cropper
    if (cropper) { cropper.destroy(); cropper = null; }

    previewImg.src = e.target.result;
    previewImg.hidden = false;
    dropHolder.style.display = 'none';
    dropZone.classList.add('drop-zone--cropping');
    bottomActions.hidden = false;
    btnConfirmCrop.hidden = false;
    btnGenerate.hidden = true;

    // 初始化 Cropper.js
    cropper = new Cropper(previewImg, {
      aspectRatio: 1,
      viewMode: 1,
      autoCropArea: 1,
      movable: true,
      zoomable: false,
      rotatable: false,
      scalable: false,
    });
  };
  reader.readAsDataURL(file);
}

// ── 重新选择 ──
btnReselect.addEventListener('click', () => {
  if (cropper) { cropper.destroy(); cropper = null; }
  previewImg.src = '';
  previewImg.hidden = true;
  dropHolder.style.display = '';
  dropZone.classList.remove('drop-zone--cropping');
  bottomActions.hidden = true;
  btnGenerate.hidden = true;
  fileInput.value = '';
  hideUploadError();
  fileInput.click();
});

// ── 确认裁剪 ──
btnConfirmCrop.addEventListener('click', () => {
  if (!cropper) return;
  const canvas = cropper.getCroppedCanvas({ width: 1200, height: 1200 });
  currentOriginalUrl = canvas.toDataURL('image/jpeg', 0.95);

  // 销毁 cropper，切换为预览模式
  cropper.destroy();
  cropper = null;
  previewImg.src = currentOriginalUrl;
  dropZone.classList.remove('drop-zone--cropping');
  btnConfirmCrop.hidden = true;
  btnGenerate.hidden = false;

  // 压缩供 API 使用
  compressImage(currentOriginalUrl);
});

function compressImage(dataUrl) {
  const img = new Image();
  img.onload = () => {
    const MAX = 800;
    let w = img.width, h = img.height;
    if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
    else if (h >= w && h > MAX) { w = Math.round(w * MAX / h); h = MAX; }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const compressed = canvas.toDataURL('image/jpeg', 0.85);
    currentBase64 = compressed.split(',')[1];
  };
  img.src = dataUrl;
}

// ── 生成 ──
btnGenerate.addEventListener('click', async () => {
  if (!currentBase64) { showUploadError('图片还在处理中，请稍等'); return; }
  showPage('loading');
  try {
    const data = await callAPI(currentBase64);
    await renderCard(data);
    showPage('result');
  } catch (err) {
    showPage('upload');
    showUploadError(err.message || 'API 调用失败，请重试');
  }
});

async function callAPI(base64) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  let res;
  try {
    res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`服务器错误 ${res.status}${text ? '：' + text : ''}`);
  }

  const json = await res.json();
  return parseAIResponse(json);
}

function parseAIResponse(apiResponse) {
  const raw = apiResponse?.choices?.[0]?.message?.content ?? '';
  // 剥离可能的 markdown 代码块包裹
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('AI 返回格式异常，请重试');
  }
}

// ── 裁切原图为 1:1 方形（center top）──
function cropSquare(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = 0; // center top
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, sx, sy, size, size, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.src = dataUrl;
  });
}

// ── 渲染卡片 ──
async function renderCard({ colorNameZh, colorNameEn, hex, letter }) {
  document.getElementById('card-photo').src = currentOriginalUrl;
  document.getElementById('card-dot').style.background = hex;
  document.getElementById('card-name-zh').textContent = colorNameZh;
  document.getElementById('card-name-en').textContent = colorNameEn;
  document.getElementById('card-letter').textContent = letter;

}

// ── 重置 ──
btnReset.addEventListener('click', () => {
  if (cropper) { cropper.destroy(); cropper = null; }
  currentBase64 = null;
  currentOriginalUrl = null;
  fileInput.value = '';
  previewImg.src = '';
  previewImg.hidden = true;
  dropHolder.style.display = '';
  dropZone.classList.remove('drop-zone--cropping');
  bottomActions.hidden = true;
  btnGenerate.hidden = true;
  hideUploadError();
  resultError.hidden = true;
  saveHint.hidden = true;
  showPage('upload');
});

// ── 保存卡片 ──
btnSave.addEventListener('click', async () => {
  const card = document.getElementById('capture');
  try {
    // 等字体加载完再截图
    await document.fonts.ready;
    const canvas = await html2canvas(card, {
      scale: 2,
      useCORS: true,
      backgroundColor: null,
      logging: false,
    });
    const link = document.createElement('a');
    link.download = `回忆的颜色_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch {
    saveHint.hidden = false;
  }
});

// ── 错误提示 ──
function showUploadError(msg) {
  uploadError.textContent = msg;
  uploadError.hidden = false;
}
function hideUploadError() {
  uploadError.hidden = true;
}
