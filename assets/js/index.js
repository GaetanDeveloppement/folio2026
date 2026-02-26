window.addEventListener("load", function () {
  const images = [];
  const observers = [];
  const scale =
    parseFloat(document.body.style.getPropertyValue("--scale-image")) || 1;
  const scrollContainerHeight = document.body.clientHeight;
  const imagesFunc = document.querySelectorAll("#scroller .parallax");

  imagesFunc.forEach((item, index) => {
    const parent = item.parentNode.parentNode;
    let imageHeight = item.offsetHeight * scale;
    let containerHeight = parent.offsetHeight;
    let gap = (imageHeight - containerHeight) / scale;

    item.dataset.index = index;
    images.push({ containerHeight, gap });

    const observer = new ResizeObserver((entries) => {
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

  // Remove any canvases cloned from already-initialized dither wrappers
  clone.querySelectorAll(".dither-wrap canvas").forEach((c) => c.remove());

  // Initialize dither on the cloned images
  window.dispatchEvent(new CustomEvent("ditherInitClone", { detail: clone }));

  const lenis = new Lenis({
    infinite: true,
    syncTouch: true,
    wrapper,
    eventsTarget: window,
  });

  const items = document.querySelectorAll(".parallax");

  const lastOffsets = new Map();
  const updateThreshold = 0.5;

  function raf(time) {
    lenis.raf(time);

    items.forEach((item) => {
      const index = item.dataset["index"];
      const { containerHeight, gap } = images[index];

      const parent = item.parentNode;
      const parentRect = parent.getBoundingClientRect();
      const y = parentRect.top;

      const pos = {
        top: y + containerHeight,
        bottom: y,
      };

      // 0 / 1
      const factor = pos.top / (scrollContainerHeight + containerHeight);

      // -1 / 1
      const power = (factor - 0.5) * 2;

      const res = (gap / 2) * power;

      const lastOffset = lastOffsets.get(item);
      if (
        lastOffset === undefined ||
        Math.abs(res - lastOffset) > updateThreshold
      ) {
        item.style.transform = `translateY(${-res}px)`;
        lastOffsets.set(item, res);
      }
    });

    requestAnimationFrame(raf);
  }

  requestAnimationFrame(raf);

  window.addEventListener("beforeunload", () => {
    observers.forEach((obs) => obs.disconnect());
  });
});
