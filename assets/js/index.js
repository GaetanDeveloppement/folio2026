const PARALLAX_SCALE_DEFAULT = 1;
const UPDATE_THRESHOLD = 0.5;
const DISSOLVE_DURATION = 1500;
const POST_DISSOLVE_DELAY = 50;

window.addEventListener("load", function () {
  const images = [];
  const observers = [];
  const scale =
    parseFloat(document.body.style.getPropertyValue("--scale-image")) || PARALLAX_SCALE_DEFAULT;
  const scrollContainerHeight = document.body.clientHeight;
  const imageElements = document.querySelectorAll("#scroller .parallax");

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

  window.dispatchEvent(new CustomEvent("ditherInitClone", { detail: clone }));

  const lenis = new Lenis({
    infinite: true,
    syncTouch: true,
    wrapper,
    eventsTarget: window,
  });

  const items = document.querySelectorAll(".parallax");
  const lastOffsets = new Map();
  let rafId = null;
  let isNavigating = false;

  function raf(time) {
    lenis.raf(time);

    items.forEach(function (item) {
      const index = item.dataset["index"];
      const { containerHeight, gap } = images[index];

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

  function cleanup() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    observers.forEach(function (obs) {
      obs.disconnect();
    });
    lenis.destroy();
  }

  window.addEventListener("beforeunload", cleanup);

  document.addEventListener("click", function (e) {
    if (isNavigating) {
      return;
    }

    const link = e.target.closest("a[href]");
    if (!link) {
      return;
    }

    const href = link.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("mailto")) {
      return;
    }

    e.preventDefault();
    isNavigating = true;

    const instances = window._ditherInstances || [];

    if (instances.length === 0) {
      window.location.href = href;
      return;
    }

    Promise.all(instances.map(function (dc) {
      return dc.dissolveToBlack(DISSOLVE_DURATION);
    }))
      .then(function () {
        return new Promise(function (r) {
          setTimeout(r, POST_DISSOLVE_DELAY);
        });
      })
      .then(function () {
        window.location.href = href;
      })
      .catch(function () {
        window.location.href = href;
      });
  });
});
