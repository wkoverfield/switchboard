/* global document, fetch, localStorage */

(() => {
  const counters = document.querySelectorAll("[data-github-stars]");
  if (counters.length === 0) return;

  const cacheKey = "switchboard.github-stars.v1";
  const cacheLifetime = 15 * 60 * 1000;
  const formatter = new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1
  });

  const render = (count) => {
    const countLabel = `${count.toLocaleString("en")} ${count === 1 ? "star" : "stars"}`;
    for (const counter of counters) {
      counter.textContent = formatter.format(count).toLowerCase();
      counter.setAttribute("aria-label", countLabel);
      counter.title = `${countLabel} on GitHub`;
    }
  };

  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey));
    if (
      Number.isInteger(cached?.count) &&
      Date.now() - cached.updatedAt < cacheLifetime
    ) {
      render(cached.count);
      return;
    }
  } catch {
    // Local storage can be unavailable without affecting navigation.
  }

  fetch("https://api.github.com/repos/wkoverfield/switchboard", {
    headers: { Accept: "application/vnd.github+json" }
  })
    .then((response) => {
      if (!response.ok) throw new Error("GitHub star count unavailable");
      return response.json();
    })
    .then((repository) => {
      const count = repository.stargazers_count;
      if (!Number.isInteger(count)) return;

      render(count);
      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({ count, updatedAt: Date.now() })
        );
      } catch {
        // The live count remains visible when storage is unavailable.
      }
    })
    .catch(() => {});
})();
