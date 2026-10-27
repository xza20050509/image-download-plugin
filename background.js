/* ============================================================
 * 电商图片提取下载插件 - background.js (Service Worker)
 * 功能：
 *   1. 接收 content.js 的 OPEN_GALLERY 消息，打开 gallery.html 新标签页
 *   2. 接收 gallery.js 的 DOWNLOAD_IMAGES 消息，
 *      跨域 fetch 图片 → createImageBitmap → OffscreenCanvas 转 PNG →
 *      chrome.downloads.download 保存到默认下载目录，并回传进度
 * ============================================================ */

// 记录正在下载的任务状态，便于去重与查询
const downloadTasks = new Map(); // key: 临时任务 id

/* ---------- 1. 打开 gallery 展示页 ---------- */
function openGallery() {
  chrome.tabs.create({ url: chrome.runtime.getURL("gallery.html") });
}

/* ---------- 2. PNG 转换核心 ---------- */
/**
 * 将图片 URL 转换为 PNG 格式的 data URL
 * 利用 host_permissions 直接跨域 fetch，避免 canvas 被污染
 * @param {string} url 图片原始 URL
 * @returns {Promise<string>} PNG data URL
 */
async function imageUrlToPngDataUrl(url) {
  // 2.1 跨域抓取图片二进制（因 manifest 声明了 host_permissions，扩展可直接 fetch，
  //     CORS 检查被绕过，响应内容可读）
  const resp = await fetch(url, { credentials: "omit" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  if (!blob || blob.size === 0) throw new Error("图片内容为空");

  // 2.2 解码为位图
  const bitmap = await createImageBitmap(blob);
  if (!bitmap.width || !bitmap.height) throw new Error("图片解码失败");

  // 2.3 绘制到 OffscreenCanvas 并导出 PNG
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  const pngBlob = await canvas.convertToBlob({ type: "image/png" });

  // 2.4 Blob → data URL
  return await blobToDataUrl(pngBlob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/* ---------- 3. 单张图片下载 ---------- */
/**
 * 下载单张图片（自动转 PNG）
 * @param {string} url 原图 URL
 * @param {string} filename 保存文件名（含 .png 后缀）
 * @returns {Promise<{ok:boolean, url:string, filename:string, error?:string}>}
 */
async function downloadOneImage(url, filename) {
  try {
    const dataUrl = await imageUrlToPngDataUrl(url);
    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: dataUrl,
          filename: filename,
          saveAs: false, // 保存到浏览器默认下载目录，不弹出另存为
        },
        (id) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(id);
        }
      );
    });
    return { ok: true, url, filename, downloadId };
  } catch (e) {
    console.error("[电商图片插件] 下载失败：", url, e);
    return { ok: false, url, filename, error: e.message || String(e) };
  }
}

/* ---------- 4. 批量下载任务 ---------- */
/**
 * 批量下载选中的图片
 * @param {Array<{url:string,width:number,height:number}>} images 图片列表
 * @param {number[]} indices 选中的索引（对应 images 数组下标）
 * @param {string} tabId 发送方 tab id（用于回传进度）
 */
async function batchDownload(images, indices, tabId) {
  const total = indices.length;
  let success = 0;
  let failed = 0;
  const results = [];

  // 逐个下载（避免同时触发过多 download 导致浏览器限速或失败）
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const img = images[idx];
    // 文件名：商品图_序号.png，序号补零到 3 位
    const seq = String(i + 1).padStart(3, "0");
    const filename = `商品图_${seq}.png`;

    const r = await downloadOneImage(img.url, filename);
    results.push(r);
    if (r.ok) success++;
    else failed++;

    // 回传进度
    sendProgress(tabId, {
      type: "DOWNLOAD_PROGRESS",
      current: i + 1,
      total,
      success,
      failed,
      currentFile: filename,
    });
  }

  // 完成通知
  sendProgress(tabId, {
    type: "DOWNLOAD_COMPLETE",
    total,
    success,
    failed,
    results,
  });
}

function sendProgress(tabId, msg) {
  // 使用 runtime.sendMessage 广播给扩展内页面（gallery.html），
  // 比 tabs.sendMessage 更可靠（后者主要面向 content script）
  chrome.runtime.sendMessage(msg).catch(() => {
    /* 无监听者时忽略 */
  });
}

/* ---------- 5. 消息监听 ---------- */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case "OPEN_GALLERY":
      openGallery();
      sendResponse({ ok: true });
      break;

    case "DOWNLOAD_IMAGES": {
      const { images, indices } = message;
      const tabId = sender.tab && sender.tab.id;
      // 异步执行，立即返回 true 保持通道开放
      batchDownload(images, indices, tabId);
      sendResponse({ ok: true, started: true });
      return true;
    }

    default:
      break;
  }
});

/* ---------- 6. 扩展安装提示 ---------- */
chrome.runtime.onInstalled.addListener((details) => {
  console.log("[电商图片插件] 已安装/更新，原因：", details.reason);
});
