// Page modules initialize at DOMContentLoaded. This coordinator does not run
// them again or equate their diagnostic flags with media/backend success.
const gate = window.EmTalkPageLoader;
if (gate?.isPending()) {
  const { signal } = gate;
  const aborted = signal.aborted ? Promise.resolve() : new Promise(resolve => signal.addEventListener("abort", resolve, { once:true }));
  const bounded = promise => signal.aborted ? Promise.resolve() : Promise.race([promise, aborted]);
  async function imageSettled(image) {
    // Limit responsive source re-waits structurally. Rapid oscillation falls
    // back to the shared deadline/intent release rather than recursive work.
    for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
      const source = image.currentSrc || image.src;
      if (!image.complete) {
        await new Promise(resolve => {
          const done = () => {
            image.removeEventListener("load", done);
            image.removeEventListener("error", done);
            signal.removeEventListener("abort", done);
            resolve();
          };
          image.addEventListener("load", done, { once:true });
          image.addEventListener("error", done, { once:true });
          signal.addEventListener("abort", done, { once:true });
          if (image.complete || signal.aborted) done();
        });
      }
      if (signal.aborted || !image.naturalWidth) return;
      if (typeof image.decode === "function") await bounded(image.decode().catch(() => {}));
      if (signal.aborted || (image.currentSrc || image.src) === source) return;
    }
    if (!signal.aborted) await aborted;
  }
  async function settleViewport() {
    if (document.readyState === "loading") {
      await bounded(new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once:true, signal })));
    }
    if (signal.aborted) return;
    await new Promise(resolve => {
      const frame = requestAnimationFrame(() => {
        signal.removeEventListener("abort", cancel);
        resolve();
      });
      function cancel() { cancelAnimationFrame(frame); resolve(); }
      signal.addEventListener("abort", cancel, { once:true });
    });
    if (signal.aborted) return;
    const images = [...document.images].filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.bottom >= 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    });
    await bounded(Promise.all([
      document.fonts?.ready ?? Promise.resolve(),
      ...images.map(imageSettled),
    ]));
    if (gate.isPending()) gate.release("settled");
  }
  settleViewport().catch(() => gate.release("coordinator-error"));
}
