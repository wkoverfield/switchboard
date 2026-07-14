/* global document, Element, history, location, URL, window */

(() => {
  const pageCache = new Map();
  let navigationSequence = 0;

  const isDocsUrl = (url) =>
    url.origin === location.origin &&
    (url.pathname === "/docs" || url.pathname.startsWith("/docs/"));

  const cacheKey = (url) => `${url.pathname}${url.search}`;

  const parsePage = (html) => {
    const parsed = new window.DOMParser().parseFromString(html, "text/html");
    const main = parsed.querySelector(".docs-main");
    if (!main) throw new Error("Docs navigation response is missing its article");

    return {
      html: main.innerHTML,
      title: parsed.title
    };
  };

  const loadPage = (url) => {
    const key = cacheKey(url);
    const cached = pageCache.get(key);
    if (cached) return cached;

    const request = window
      .fetch(url.href, { headers: { Accept: "text/html" } })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Docs navigation failed with ${response.status}`);
        }
        return response.text();
      })
      .then(parsePage)
      .catch((error) => {
        pageCache.delete(key);
        throw error;
      });

    pageCache.set(key, request);
    return request;
  };

  const updateSidebar = (pathname) => {
    for (const link of document.querySelectorAll(".docs-sidebar a[href]")) {
      const current = new URL(link.href, location.href).pathname === pathname;
      link.classList.toggle("active", current);
      if (current) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  };

  const focusArticle = (url) => {
    if (url.hash) {
      const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (target) {
        target.scrollIntoView();
        return;
      }
    }

    window.scrollTo(0, 0);
    const heading = document.querySelector(".docs-main h1");
    if (!heading) return;

    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
    heading.addEventListener(
      "blur",
      () => heading.removeAttribute("tabindex"),
      { once: true }
    );
  };

  const renderPage = (page, url, historyMode) => {
    const main = document.querySelector(".docs-main");
    if (!main) throw new Error("Docs navigation shell is missing its article");

    main.innerHTML = page.html;
    document.title = page.title;
    updateSidebar(url.pathname);

    if (historyMode === "push") {
      history.pushState({ docs: true }, "", url.href);
    }

    focusArticle(url);
  };

  const navigate = async (url, historyMode) => {
    const sequence = ++navigationSequence;
    const main = document.querySelector(".docs-main");
    main?.setAttribute("aria-busy", "true");

    try {
      const page = await loadPage(url);
      if (sequence !== navigationSequence) return;
      renderPage(page, url, historyMode);
    } catch {
      if (sequence === navigationSequence) location.assign(url.href);
    } finally {
      if (sequence === navigationSequence) {
        main?.removeAttribute("aria-busy");
      }
    }
  };

  const initialMain = document.querySelector(".docs-main");
  if (initialMain) {
    pageCache.set(
      cacheKey(new URL(location.href)),
      Promise.resolve({ html: initialMain.innerHTML, title: document.title })
    );
  }

  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      !(event.target instanceof Element)
    ) {
      return;
    }

    const anchor = event.target.closest("a[href]");
    if (
      !anchor ||
      anchor.hasAttribute("download") ||
      (anchor.target && anchor.target !== "_self")
    ) {
      return;
    }

    const url = new URL(anchor.href, location.href);
    if (!isDocsUrl(url)) return;

    const samePage =
      url.pathname === location.pathname && url.search === location.search;
    if (samePage && url.hash) return;

    event.preventDefault();
    if (!samePage) void navigate(url, "push");
  });

  const warmLink = (event) => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href]");
    if (!anchor) return;

    const url = new URL(anchor.href, location.href);
    if (isDocsUrl(url)) void loadPage(url).catch(() => {});
  };

  document.addEventListener("pointerover", warmLink, { passive: true });
  document.addEventListener("focusin", warmLink);

  window.addEventListener("popstate", () => {
    const url = new URL(location.href);
    if (isDocsUrl(url)) void navigate(url, "none");
  });
})();
