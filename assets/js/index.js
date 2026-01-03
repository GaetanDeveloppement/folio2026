window.addEventListener("load", function () {
  const images = [];
  const observers = [];
  const scale = document.body.style.getPropertyValue("--scale-image");
  const scrollContainerHeight = document.body.clientHeight;
  const imagesFunc = document.querySelectorAll("#scroller .parallax");

  imagesFunc.forEach((item, index) => {
    const parent = item.parentNode; // Cache parent reference
    let imageHeight = item.offsetHeight * scale;
    let containerHeight = parent.offsetHeight;
    let gap = (imageHeight - containerHeight) / scale;

    item.dataset.index = index;
    images.push({ containerHeight, gap });

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]; // Only one entry per observer
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

  const lenis = new Lenis({
    infinite: true,
    syncTouch: true,
    wrapper,
    eventsTarget: window,
  });

  const items = document.querySelectorAll(".parallax");

  function raf(time) {
    lenis.raf(time);

    items.forEach((item) => {
      const index = item.dataset["index"];
      const { containerHeight, gap } = images[index];
      const y = item.y;
      const pos = {
        top: y + containerHeight,
        bottom: y,
      };

      if (pos.top >= 0 && pos.bottom < scrollContainerHeight) {
        // 0 / 1
        const factor = pos.top / (scrollContainerHeight + containerHeight);

        // -1 / 1
        const power = (factor - 0.5) * 2;

        const res = (gap / 2) * power;

        item.style.setProperty("--offset", -res + "px");
      }
    });

    requestAnimationFrame(raf);
  }

  requestAnimationFrame(raf);

  window.addEventListener("beforeunload", () => {
    observers.forEach((obs) => obs.disconnect());
  });
});
