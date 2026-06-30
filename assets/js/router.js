const REVEAL_STAGGER_DELAY = 80;
const REVEAL_INITIAL_DELAY = 100;
const FETCH_TIMEOUT = 8000;

let isNavigating = false;

function isInternalLink(href) {
  if (!href) {
    return false;
  }

  if (
    href.startsWith("http") ||
    href.startsWith("mailto") ||
    href.startsWith("tel")
  ) {
    return false;
  }

  return true;
}

function parseRemotePage(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const main = doc.querySelector("main");
  const title = doc.querySelector("title");
  const layout = doc.body.dataset.layout || "home";

  return {
    mainHTML: main ? main.innerHTML : null,
    title: title ? title.textContent : document.title,
    layout,
  };
}

function swapContent(parsed) {
  const main = document.querySelector("main");
  if (!main || !parsed.mainHTML) {
    return;
  }

  main.innerHTML = parsed.mainHTML;
  document.title = parsed.title;
  document.body.dataset.layout = parsed.layout;
}

function fetchPage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(function () {
    controller.abort();
  }, FETCH_TIMEOUT);

  return fetch(url, { signal: controller.signal })
    .then(function (response) {
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error("Fetch failed: " + response.status);
      }
      return response.text();
    })
    .catch(function (err) {
      clearTimeout(timeoutId);
      throw err;
    });
}

function getRevealTargets() {
  return {
    bioItems: document.querySelectorAll(
      "main > .sidebar > header > *:not(h1), main > .sidebar > .bio > *, main > .sidebar > .details-container > *",
    ),
    projectTitles: document.querySelectorAll(".project-item p"),
  };
}

function revealTextElements() {
  const { bioItems, projectTitles } = getRevealTargets();

  requestAnimationFrame(function () {
    bioItems.forEach(function (el, i) {
      const delay = REVEAL_INITIAL_DELAY + i * REVEAL_STAGGER_DELAY;
      el.style.transitionDelay = delay + "ms";
      el.classList.add("is-visible");
    });

    projectTitles.forEach(function (p, i) {
      const delay = REVEAL_INITIAL_DELAY + i * REVEAL_STAGGER_DELAY;
      p.style.transitionDelay = delay + "ms";
      p.classList.add("is-visible");
    });
  });
}

function unrevealTextElements() {
  const { bioItems, projectTitles } = getRevealTargets();

  for (let i = bioItems.length - 1; i >= 0; i--) {
    const delay = (bioItems.length - 1 - i) * REVEAL_STAGGER_DELAY;
    bioItems[i].style.transitionDelay = delay + "ms";
    bioItems[i].classList.remove("is-visible");
  }

  projectTitles.forEach(function (p) {
    p.style.transitionDelay = "0ms";
    p.classList.remove("is-visible");
  });
}

function performTransition(href, pushToHistory) {
  if (isNavigating) {
    return;
  }

  isNavigating = true;

  let fetchPromise = fetchPage(href);

  unrevealTextElements();

  Promise.all([window.dissolveAllToBlack(), window.growHoveredCircles()])
    .then(function () {
      return fetchPromise;
    })
    .then(function (html) {
      const parsed = parseRemotePage(html);
      if (!parsed.mainHTML) {
        throw new Error("No <main> found in remote page");
      }

      window.saveScrollPosition();
      window.destroyScroll();
      window.destroyAllDither();

      swapContent(parsed);
      window.scrollTo(0, 0);

      if (pushToHistory) {
        history.pushState({ href }, parsed.title, href);
      }

      window.initScroll();
      window.initDither();

      revealTextElements();
    })
    .then(function () {
      isNavigating = false;
    })
    .catch(function () {
      window.location.href = href;
    });
}

function handleClick(e) {
  if (isNavigating) {
    return;
  }

  const link = e.target.closest("a[href]");
  if (!link) {
    return;
  }

  if (link.getAttribute("target") === "_blank") {
    return;
  }

  const href = link.getAttribute("href");
  if (!isInternalLink(href)) {
    return;
  }

  e.preventDefault();

  const item = link.closest(".project-item");
  if (item) {
    sessionStorage.setItem(
      "transition-item-top",
      String(item.getBoundingClientRect().top),
    );
  }

  performTransition(href, true);
}

function handlePopState() {
  if (isNavigating) {
    return;
  }

  const href = window.location.pathname + window.location.search;
  performTransition(href, false);
}

document.addEventListener("click", handleClick);
window.addEventListener("popstate", handlePopState);

window.addEventListener("load", function () {
  revealTextElements();
});
