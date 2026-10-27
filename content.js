/* ============================================================
 * 电商图片提取下载插件 - content.js
 * 功能：在商品详情页注入悬浮「获取图片」按钮，
 *       点击后扫描页面所有商品图片（含懒加载/背景图），
 *       过滤、去重、补全绝对路径，然后打开 gallery 展示页。
 * ============================================================ */

(function () {
  "use strict";

  /* ---------- 1. 判断是否为目标平台 ---------- */
  const HOST = location.hostname;
  const IS_TARGET =
    /(^|\.)taobao\.com$/.test(HOST) ||
    /(^|\.)tmall\.com$/.test(HOST) ||
    /(^|\.)jd\.com$/.test(HOST) ||
    /(^|\.)pinduoduo\.com$/.test(HOST) ||
    /(^|\.)yangkeduo\.com$/.test(HOST);

  if (!IS_TARGET) return;

  /* ---------- 2. 注入悬浮按钮 ---------- */
  const BUTTON_ID = "ecc-float-btn";
  const TOAST_ID = "ecc-toast";

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.className = "ecc-float-btn";
    btn.textContent = "获取图片";
    btn.addEventListener("click", onButtonClick);
    document.body.appendChild(btn);
  }

  function showToast(msg, duration = 2500) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.className = "ecc-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    // 强制重排后再添加 show 类，保证过渡动画生效
    void toast.offsetWidth;
    toast.classList.add("ecc-show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove("ecc-show"), duration);
  }

  function setButtonLoading(loading) {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    if (loading) {
      btn.classList.add("ecc-loading");
      btn.disabled = true;
    } else {
      btn.classList.remove("ecc-loading");
      btn.disabled = false;
    }
  }

  /* ---------- 3. 图片提取核心逻辑 ---------- */

  // 尺寸阈值（宽或高小于此值视为小图/图标，过滤）
  const MIN_SIZE = 100;

  // URL 中包含这些关键词的视为非商品图（logo/图标/占位等）
  const BLOCK_KEYWORDS = [
    "logo",
    "icon",
    "spacer",
    "placeholder",
    "loading",
    "1x1",
    "1_1",
    "pixel",
    "avatar",
    "headimg",
    "qrcode",
    "qr_code",
    "blank",
    "empty",
    "btn_",
    "button",
    "banner", // 部分 banner 可能是商品，但为避免混入先过滤；如需要可注释
  ];

  // 图片扩展名白名单
  const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)(\?|$)/i;

  /**
   * 将相对 URL 补全为绝对 URL
   */
  function toAbsolute(url) {
    if (!url) return "";
    url = url.trim().replace(/^url\(["']?|["']?\)$/g, ""); // 去除 background-image 的 url() 包裹
    if (!url) return "";
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return "";
    }
  }

  /**
   * 解析 srcset，返回其中所有 URL
   * 例如 "a.jpg 1x, b.jpg 2x" => ["a.jpg","b.jpg"]
   */
  function parseSrcset(srcset) {
    if (!srcset) return [];
    return srcset
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  /**
   * 判断一个 URL 是否应该被过滤
   */
  function isBlockedUrl(url) {
    const lower = url.toLowerCase();
    // 1. 排除 data URI 之外的非 http(s)（如 blob: 仅做临时不收集）
    if (!/^https?:/i.test(url) && !/^data:image/i.test(url)) return true;
    // 2. 关键词过滤
    for (const kw of BLOCK_KEYWORDS) {
      if (lower.includes(kw)) return true;
    }
    // 3. 排除明显的脚本/样式链接
    if (/\.(js|css|svg)(\?|$)/i.test(url)) return true;
    return false;
  }

  /**
   * 收集页面中所有候选图片 URL
   * 来源：<img src/srcset>、各类懒加载属性、元素背景图
   */
  function collectCandidateUrls() {
    const set = new Set();
    const add = (u) => {
      const abs = toAbsolute(u);
      if (abs && !isBlockedUrl(abs)) set.add(abs);
    };

    // 3.1 扫描所有 <img> 标签
    const imgs = document.querySelectorAll("img");
    imgs.forEach((img) => {
      add(img.getAttribute("src"));
      add(img.getAttribute("data-src"));
      add(img.getAttribute("data-lazy-src"));
      add(img.getAttribute("data-original"));
      add(img.getAttribute("data-image"));
      add(img.getAttribute("data-img"));
      add(img.getAttribute("data-ks-lazyload")); // 淘宝/天猫部分懒加载
      add(img.getAttribute("data-ks-original"));
      add(img.getAttribute("data-srcset"));
      // srcset
      parseSrcset(img.getAttribute("srcset")).forEach(add);
      parseSrcset(img.getAttribute("data-srcset")).forEach(add);
    });

    // 3.2 扫描带背景图的元素（通过 computed style）
    const all = document.querySelectorAll("*");
    all.forEach((el) => {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none") {
        // 可能包含多个 url(...)，逐个提取
        const matches = bg.match(/url\(["']?([^"')]+)["']?\)/g) || [];
        matches.forEach((m) => {
          const inner = m.replace(/^url\(["']?|["']?\)$/g, "");
          add(inner);
        });
      }
    });

    return Array.from(set);
  }

  /**
   * 通过 Image 对象预加载以获取真实尺寸
   * 返回 Promise<{url, width, height}>
   */
  function loadImageSize(url, timeout = 6000) {
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const finish = (w, h) => {
        if (done) return;
        done = true;
        resolve({ url, width: w || 0, height: h || 0 });
      };
      img.onload = () => finish(img.naturalWidth, img.naturalHeight);
      img.onerror = () => finish(0, 0);
      img.src = url;
      setTimeout(() => finish(img.naturalWidth, img.naturalHeight), timeout);
    });
  }

  /**
   * 提取并过滤图片
   */
  async function extractImages() {
    const candidates = collectCandidateUrls();
    console.log("[电商图片插件] 候选图片数量：", candidates.length);

    // 并发加载尺寸（限制并发数避免阻塞）
    const results = [];
    const CONCURRENCY = 8;
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const chunk = candidates.slice(i, i + CONCURRENCY);
      const sizes = await Promise.all(chunk.map(loadImageSize));
      results.push(...sizes);
    }

    // 过滤：尺寸 >= MIN_SIZE 且加载成功
    const valid = results.filter(
      (r) => r.width >= MIN_SIZE && r.height >= MIN_SIZE
    );

    console.log("[电商图片插件] 有效图片数量：", valid.length);
    return valid;
  }

  /* ---------- 4. 按钮点击处理 ---------- */
  async function onButtonClick() {
    setButtonLoading(true);
    showToast("正在扫描页面图片，请稍候…");
    try {
      const images = await extractImages();
      if (images.length === 0) {
        showToast("未找到符合条件的商品图片", 3000);
        return;
      }
      // 存入 storage，供 gallery 页面读取
      await chrome.storage.local.set({ ecc_images: images });
      // 通知 background 打开 gallery 页面
      chrome.runtime.sendMessage({ type: "OPEN_GALLERY" }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn("[电商图片插件] 消息发送失败：", chrome.runtime.lastError);
        }
      });
      showToast(`已提取 ${images.length} 张图片，正在打开展示页…`);
    } catch (e) {
      console.error("[电商图片插件] 提取失败：", e);
      showToast("图片提取失败，请刷新页面重试", 3000);
    } finally {
      setButtonLoading(false);
    }
  }

  /* ---------- 5. 初始化 ---------- */
  function init() {
    ensureButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // SPA 路由切换时 body 可能被重建，使用 MutationObserver 保证按钮始终存在
  const observer = new MutationObserver(() => ensureButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
