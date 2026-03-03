const PARALLAX_SCALE_DEFAULT = 1;
const UPDATE_THRESHOLD = 0.5;
const SCROLL_POSITION_KEY = "carousel-scroll-position";

let images = [];
let observers = [];
let lenis = null;
let rafId = null;
let lastOffsets = new Map();
let items = [];
let scrollContainerHeight = 0;

function getIsProjectPage() {
  return document.body.dataset.layout === "project";
}

function initScroll() {
  images = [];
  observers = [];
  lastOffsets = new Map();

  const scale =
    parseFloat(getComputedStyle(document.body).getPropertyValue("--scale-image")) || PARALLAX_SCALE_DEFAULT;
  scrollContainerHeight = document.body.clientHeight;
  const imageElements = document.querySelectorAll("#scroller .parallax");
  const isProjectPage = getIsProjectPage();

  imageElements.forEach(function (item, index) {
    const parent = item.parentNode.parentNode;
    let imageHeight = item.offsetHeight * scale;
    let containerHeight = parent.offsetHeight;
    let gap = (imageHeight - containerHeight) / scale;

    item.dataset.index = index;
    images.push({ containerHeight, gap });

    const observer = new ResizeObserver(function (entries) {
      const entry = entries[0];
      imageHeight = entry.target.offsetHeight * scale;
      containerHeight = parent.offsetHeight;
      gap = (imageHeight - containerHeight) / scale;
      images[index] = { containerHeight, gap };
    });

    observer.observe(item);
    observers.push(observer);
  });

  const scroller = document.getElementById("scroller");
  const wrapper = document.getElementById("wrapper");

  const clone = scroller.cloneNode(true);
  scroller.after(clone);
  clone.id = "clone";

  clone.querySelectorAll(".dither-wrap canvas").forEach(function (c) {
    c.remove();
  });

  clone.querySelectorAll("[data-dither-initialized]").forEach(function (el) {
    el.removeAttribute("data-dither-initialized");
  });

  if (!isProjectPage) {
    window.dispatchEvent(new CustomEvent("ditherInitClone", { detail: clone }));
  }

  lenis = new Lenis({
    infinite: true,
    syncTouch: true,
    wrapper,
    eventsTarget: window,
  });

  const restoreKey = isProjectPage ? SCROLL_POSITION_KEY + "-project" : SCROLL_POSITION_KEY;
  const savedPosition = sessionStorage.getItem(restoreKey);
  if (savedPosition) {
    const position = parseFloat(savedPosition);
    lenis.scrollTo(position, { immediate: true });
    sessionStorage.removeItem(restoreKey);
  }

  items = Array.from(document.querySelectorAll(".parallax"));

  function raf(time) {
    lenis.raf(time);

    items.forEach(function (item) {
      const index = item.dataset["index"];
      const data = images[index];
      if (!data) {
        return;
      }

      const { containerHeight, gap } = data;
      const parent = item.parentNode;
      const parentRect = parent.getBoundingClientRect();
      const y = parentRect.top;

      const pos = {
        top: y + containerHeight,
        bottom: y,
      };

      const factor = pos.top / (scrollContainerHeight + containerHeight);
      const power = (factor - 0.5) * 2;
      const res = (gap / 2) * power;

      const lastOffset = lastOffsets.get(item);
      if (
        lastOffset === undefined ||
        Math.abs(res - lastOffset) > UPDATE_THRESHOLD
      ) {
        item.style.transform = `translateY(${-res}px)`;
        lastOffsets.set(item, res);
      }
    });

    rafId = requestAnimationFrame(raf);
  }

  rafId = requestAnimationFrame(raf);
}

function destroyScroll() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  observers.forEach(function (obs) {
    obs.disconnect();
  });
  observers = [];

  if (lenis) {
    lenis.destroy();
    lenis = null;
  }

  const clone = document.getElementById("clone");
  if (clone) {
    clone.remove();
  }

  images = [];
  items = [];
  lastOffsets = new Map();
}

function saveScrollPosition() {
  if (!lenis) {
    return;
  }

  const isProjectPage = getIsProjectPage();
  const storageKey = isProjectPage ? SCROLL_POSITION_KEY + "-project" : SCROLL_POSITION_KEY;
  sessionStorage.setItem(storageKey, String(lenis.scroll));
}

window.addEventListener("load", function () {
  initScroll();
});

window.addEventListener("beforeunload", function () {
  destroyScroll();
});

window.initScroll = initScroll;
window.destroyScroll = destroyScroll;
window.saveScrollPosition = saveScrollPosition;
