const DISSOLVE_DURATION = 1500;
const POST_DISSOLVE_DELAY = 50;
const FETCH_TIMEOUT = 8000;

let isNavigating = false;

function isInternalLink(href) {
    if (!href) {
        return false;
    }

    if (href.startsWith("http") || href.startsWith("mailto") || href.startsWith("tel")) {
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

function navigateTo(href) {
    if (isNavigating) {
        return;
    }

    isNavigating = true;

    window.saveScrollPosition();

    let fetchPromise = fetchPage(href);

    window.dissolveAllToBlack(DISSOLVE_DURATION)
        .then(function () {
            return new Promise(function (resolve) {
                setTimeout(resolve, POST_DISSOLVE_DELAY);
            });
        })
        .then(function () {
            return fetchPromise;
        })
        .then(function (html) {
            const parsed = parseRemotePage(html);
            if (!parsed.mainHTML) {
                throw new Error("No <main> found in remote page");
            }

            window.destroyScroll();
            window.destroyAllDither();

            swapContent(parsed);
            history.pushState({ href }, parsed.title, href);

            window.initScroll();
            window.initDither();

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
    navigateTo(href);
}

function handlePopState(e) {
    if (isNavigating) {
        return;
    }

    const href = window.location.pathname + window.location.search;

    isNavigating = true;

    window.saveScrollPosition();

    let fetchPromise = fetchPage(href);

    window.dissolveAllToBlack(DISSOLVE_DURATION)
        .then(function () {
            return new Promise(function (resolve) {
                setTimeout(resolve, POST_DISSOLVE_DELAY);
            });
        })
        .then(function () {
            return fetchPromise;
        })
        .then(function (html) {
            const parsed = parseRemotePage(html);
            if (!parsed.mainHTML) {
                throw new Error("No <main> found in remote page");
            }

            window.destroyScroll();
            window.destroyAllDither();

            swapContent(parsed);
            document.title = parsed.title;

            window.initScroll();
            window.initDither();

            isNavigating = false;
        })
        .catch(function () {
            window.location.reload();
        });
}

document.addEventListener("click", handleClick);
window.addEventListener("popstate", handlePopState);
