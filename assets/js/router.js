const DISSOLVE_DURATION = 700;
const REVEAL_STAGGER_DELAY = 80;
const REVEAL_INITIAL_DELAY = 100;
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


function revealTextElements() {
    const info = document.querySelector("main > .info > div");
    if (!info) {
        return;
    }

    const children = info.children;
    for (let i = 0; i < children.length; i++) {
        children[i].classList.add("reveal-line");
    }

    const socials = document.querySelector("main > .info > .socials");
    if (socials) {
        socials.classList.add("reveal-line");
    }

    requestAnimationFrame(function () {
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const delay = REVEAL_INITIAL_DELAY + (i * REVEAL_STAGGER_DELAY);
            child.style.transitionDelay = delay + "ms";
            child.classList.add("is-visible");
        }

        if (socials) {
            const socialsDelay = REVEAL_INITIAL_DELAY + (children.length * REVEAL_STAGGER_DELAY);
            socials.style.transitionDelay = socialsDelay + "ms";
            socials.classList.add("is-visible");
        }
    });
}

function performTransition(href, pushToHistory) {
    if (isNavigating) {
        return;
    }

    isNavigating = true;

    window.saveScrollPosition();

    let fetchPromise = fetchPage(href);

    Promise.all([
        window.dissolveAllToBlack(DISSOLVE_DURATION),
    ])
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
        sessionStorage.setItem("transition-item-top", String(item.getBoundingClientRect().top));
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
