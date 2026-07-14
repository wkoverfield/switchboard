/* global document, Element, URL, window */

(() => {
  let keyboardNavigation = false;

  const isDocsPath = (pathname) =>
    pathname === "/docs" || pathname.startsWith("/docs/");

  document.addEventListener(
    "click",
    (event) => {
      const anchor =
        event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !anchor ||
        event.defaultPrevented ||
        (anchor.target && anchor.target !== "_self") ||
        anchor.hasAttribute("download")
      ) {
        return;
      }

      const destination = new URL(anchor.href, window.location.href);
      const sameDocument =
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search;

      if (destination.origin !== window.location.origin || sameDocument) return;
      keyboardNavigation = event.detail === 0;
    },
    true
  );

  window.addEventListener("pageswap", (event) => {
    if (
      keyboardNavigation ||
      event.activation?.navigationType === "traverse"
    ) {
      event.viewTransition?.skipTransition();
    }
    keyboardNavigation = false;
  });

  window.addEventListener("pagereveal", (event) => {
    const transitionTypes = event.viewTransition?.types;
    const activation = globalThis.navigation?.activation;
    if (
      !transitionTypes?.add ||
      !activation?.from?.url ||
      !activation.entry?.url
    ) {
      return;
    }

    const fromPath = new URL(activation.from.url).pathname;
    const toPath = new URL(activation.entry.url).pathname;
    const fromDocs = isDocsPath(fromPath);
    const toDocs = isDocsPath(toPath);

    if (fromDocs && toDocs) {
      transitionTypes.add("docs-to-docs");
    } else if (!fromDocs && toDocs) {
      transitionTypes.add("enter-docs");
    } else if (fromDocs && !toDocs) {
      transitionTypes.add("exit-docs");
    }
  });

  window.addEventListener("pageshow", () => {
    keyboardNavigation = false;
  });
})();
