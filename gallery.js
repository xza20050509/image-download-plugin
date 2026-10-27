/* ============================================================
 * gallery.js - 商品图片展示与下载交互
 * 功能：
 *   1. 从 chrome.storage.local 读取 content.js 存入的图片列表
 *   2. 渲染网格（缩略图 / 尺寸 / 复选框）
 *   3. 全选 / 反选 / 已选计数
 *   4. 点击「下载选中」后，通知 background 批量下载（转 PNG），
 *      并实时接收进度与结果反馈
 * ============================================================ */

let images = []; // 全部图片 [{url,width,height}]
let selected = new Set(); // 选中的索引

const $gallery = document.getElementById("gallery");
const $totalCount = document.getElementById("total-count");
const $selectedCount = document.getElementById("selected-count");
const $btnSelectAll = document.getElementById("btn-select-all");
const $btnInvert = document.getElementById("btn-invert");
const $btnDownload = document.getElementById("btn-download");
const $progressWrap = document.getElementById("progress-bar");
const $progressFill = document.getElementById("progress-fill");
const $progressText = document.getElementById("progress-text");
const $resultToast = document.getElementById("result-toast");

/* ---------- 1. 初始化：读取图片并渲染 ---------- */
async function init() {
  const data = await chrome.storage.local.get("ecc_images");
  images = data.ecc_images || [];

  if (images.length === 0) {
    $gallery.innerHTML =
      '<div class="empty-tip">未找到图片数据，请回到商品详情页点击「获取图片」按钮。</div>';
    return;
  }

  renderGallery();
  updateSelectionUI();
}

/* ---------- 2. 渲染网格 ---------- */
function renderGallery() {
  $gallery.innerHTML = "";
  images.forEach((img, idx) => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.index = idx;

    card.innerHTML = `
      <div class="checkbox"></div>
      <div class="thumb-wrap">
        <img src="${escapeHtml(img.url)}" alt="商品图 ${idx + 1}" loading="lazy" />
      </div>
      <div class="meta">
        <span>#${String(idx + 1).padStart(3, "0")}</span>
        <span>${img.width} × ${img.height}</span>
      </div>
    `;

    card.addEventListener("click", () => toggleSelect(idx));
    $gallery.appendChild(card);
  });

  $totalCount.textContent = `共 ${images.length} 张`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------- 3. 选择逻辑 ---------- */
function toggleSelect(idx) {
  if (selected.has(idx)) selected.delete(idx);
  else selected.add(idx);
  updateCardState(idx);
  updateSelectionUI();
}

function updateCardState(idx) {
  const card = $gallery.querySelector(`.card[data-index="${idx}"]`);
  if (!card) return;
  card.classList.toggle("selected", selected.has(idx));
}

function updateSelectionUI() {
  const n = selected.size;
  $selectedCount.textContent = `已选 ${n} 张`;
  $btnDownload.disabled = n === 0;
  $btnSelectAll.textContent = n === images.length && images.length > 0 ? "全不选" : "全选";
}

$btnSelectAll.addEventListener("click", () => {
  if (selected.size === images.length) {
    selected.clear();
  } else {
    selected = new Set(images.map((_, i) => i));
  }
  images.forEach((_, i) => updateCardState(i));
  updateSelectionUI();
});

$btnInvert.addEventListener("click", () => {
  const next = new Set();
  images.forEach((_, i) => {
    if (!selected.has(i)) next.add(i);
  });
  selected = next;
  images.forEach((_, i) => updateCardState(i));
  updateSelectionUI();
});

/* ---------- 4. 下载 ---------- */
$btnDownload.addEventListener("click", startDownload);

async function startDownload() {
  if (selected.size === 0) return;

  const indices = Array.from(selected).sort((a, b) => a - b);
  const selectedImages = indices.map((i) => images[i]);

  // 锁定按钮，显示进度条
  setDownloadingUI(true);

  // 通知 background 开始批量下载
  chrome.runtime.sendMessage(
    { type: "DOWNLOAD_IMAGES", images: selectedImages, indices: indices.map((_, i) => i) },
    (res) => {
      if (chrome.runtime.lastError) {
        showResult(`下载启动失败：${chrome.runtime.lastError.message}`, false);
        setDownloadingUI(false);
      }
    }
  );
}

/* ---------- 5. 进度与结果反馈 ---------- */
function setDownloadingUI(downloading) {
  $btnDownload.disabled = downloading;
  $btnSelectAll.disabled = downloading;
  $btnInvert.disabled = downloading;
  if (downloading) {
    $progressWrap.classList.remove("hidden");
    $progressFill.style.width = "0%";
    $progressText.textContent = "准备下载…";
  } else {
    // 保留进度条显示，结果由 toast 展示
  }
}

function showProgress(current, total, success, failed, currentFile) {
  const pct = Math.round((current / total) * 100);
  $progressFill.style.width = pct + "%";
  $progressText.textContent = `正在下载 ${current}/${total} ｜ 成功 ${success} ｜ 失败 ${failed} ｜ 当前：${currentFile}`;
}

function showResult(text, success) {
  $resultToast.innerHTML = text;
  $resultToast.classList.remove("hidden");
  // 4 秒后自动隐藏
  clearTimeout(showResult._timer);
  showResult._timer = setTimeout(() => {
    $resultToast.classList.add("hidden");
  }, 4500);
}

/* ---------- 6. 监听 background 的进度消息 ---------- */
chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case "DOWNLOAD_PROGRESS":
      showProgress(
        message.current,
        message.total,
        message.success,
        message.failed,
        message.currentFile
      );
      break;

    case "DOWNLOAD_COMPLETE": {
      const { total, success, failed } = message;
      setDownloadingUI(false);
      let html = `下载完成！共 ${total} 张<br>`;
      html += `<span class="success">成功 ${success} 张</span>`;
      if (failed > 0) html += ` ｜ <span class="fail">失败 ${failed} 张</span>`;
      html += `<br><span style="font-size:12px;color:#bbb">已保存到浏览器默认下载目录</span>`;
      showResult(html, success > 0);
      break;
    }

    default:
      break;
  }
});

/* ---------- 启动 ---------- */
init();
