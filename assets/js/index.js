window.addEventListener("load", function () {
  const images = [];
  const scale = document.body.style.getPropertyValue("--scale-image");
  const scrollContainerHeight = document.body.clientHeight;

  document.querySelectorAll("#scroller .parallax").forEach((item, index) => {
    // 868 -> 868
    const imageHeight = parseInt(item.offsetHeight) * scale;
    // 620 -> 620
    const containerHeight = parseInt(item.parentNode.offsetHeight);
    const gap = (imageHeight - containerHeight) / scale;
    console.log(
      "imageHeight",
      imageHeight,
      "containerHeight",
      containerHeight,
      "gap",
      gap,
    );

    item.dataset.index = index;
    images.push({ imageHeight, containerHeight, gap });
  });

  const scroller = document.getElementById("scroller");
  const wrapper = document.getElementById("wrapper");

  const clone = scroller.cloneNode(true);
  scroller.after(clone);
  clone.id = "clone";

  const lenis = new Lenis({
    autoRaf: true,
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
      const { containerHeight, imageHeight, gap } = images[index];
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
});
