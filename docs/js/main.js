/* ============================================================
 * 电商图片提取下载插件 - 官网交互脚本
 * 功能：导航栏滚动效果、移动端菜单切换、平滑滚动
 * ============================================================ */

(function () {
  "use strict";

  /* ---------- 1. 导航栏滚动时添加阴影/背景 ---------- */
  const navbar = document.getElementById("navbar");

  function onScroll() {
    if (window.scrollY > 10) {
      navbar.classList.add("scrolled");
    } else {
      navbar.classList.remove("scrolled");
    }
  }

  // 节流处理滚动事件，减少性能开销
  let ticking = false;
  window.addEventListener("scroll", function () {
    if (!ticking) {
      window.requestAnimationFrame(function () {
        onScroll();
        ticking = false;
      });
      ticking = true;
    }
  });

  // 初始化时执行一次
  onScroll();

  /* ---------- 2. 移动端汉堡菜单 ---------- */
  const navToggle = document.getElementById("navToggle");
  const navLinks = document.getElementById("navLinks");

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () {
      navLinks.classList.toggle("open");
      const isOpen = navLinks.classList.contains("open");
      navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    // 点击导航链接后关闭移动菜单
    navLinks.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navLinks.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---------- 3. 平滑滚动到锚点（兼容不支持 scroll-behavior 的浏览器） ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener("click", function (e) {
      const href = this.getAttribute("href");
      if (href === "#" || href.length <= 1) return;

      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        const navbarHeight = navbar ? navbar.offsetHeight : 0;
        const targetTop =
          target.getBoundingClientRect().top + window.scrollY - navbarHeight + 1;

        window.scrollTo({
          top: targetTop,
          behavior: "smooth",
        });
      }
    });
  });

  /* ---------- 4. 滚动进入视口时的淡入动画（可选增强） ---------- */
  const fadeEls = document.querySelectorAll(
    ".feature-card, .platform-card, .usage-step, .step"
  );

  // 仅在浏览器支持 IntersectionObserver 时启用
  if ("IntersectionObserver" in window && fadeEls.length > 0) {
    // 初始隐藏状态由 CSS 内联样式控制，避免无 JS 时内容不可见
    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.style.opacity = "1";
            entry.target.style.transform = "translateY(0)";
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    fadeEls.forEach(function (el) {
      el.style.opacity = "0";
      el.style.transform = "translateY(24px)";
      el.style.transition =
        "opacity 0.6s ease, transform 0.6s ease";
      observer.observe(el);
    });
  }
})();
