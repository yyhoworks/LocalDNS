export function initialize() {

  'use strict';
  const header = document.querySelector('.top-header-grid');
  if (!header) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let width = document.documentElement.clientWidth;
  let current = 0, target = 0, frame = 0, previousTime = 0;
  const clamp = value => Math.max(0, Math.min(1, value));

  function paint() {
    const mobile = width <= 600;
    const inset = mobile ? 8 : 16;
    const topGutter = mobile ? 14 : width <= 1120 ? 18 : Math.max(24, (width - 1720) / 2 + 24);
    const floatingGutter = mobile ? 22 : width <= 900 ? 28 : 40;
    header.style.setProperty('--navbar-progress', current.toFixed(4));
    header.style.setProperty('--navbar-offset', `${(current * (mobile ? 8 : 12)).toFixed(2)}px`);
    header.style.setProperty('--navbar-scale', (1 - 2 * inset * current / width).toFixed(6));
    header.style.setProperty('--navbar-radius', `${(current * 16).toFixed(2)}px`);
    header.style.setProperty('--navbar-gutter', `${(topGutter + (floatingGutter - topGutter) * current).toFixed(2)}px`);
    header.dataset.floating = String(current > .01);
  }

  function tick(time) {
    // A fixed header bounds layout work to this one row. Text is never transformed.
    const dt = Math.min(64, previousTime ? time - previousTime : 16.67);
    previousTime = time;
    current += (target - current) * (1 - Math.exp(-dt / 70));
    if (Math.abs(target - current) < .0005) current = target;
    paint();
    if (current !== target) frame = requestAnimationFrame(tick);
    else { frame = 0; previousTime = 0; }
  }

  function update() {
    const scroll = Math.max(0, window.scrollY);
    // Match the reference's continuous release from the top over the first 120px.
    target = reduce.matches ? Number(scroll > 12) : clamp(scroll / 120);
    if (reduce.matches || document.hidden) {
      cancelAnimationFrame(frame); frame = 0; previousTime = 0;
      current = target; paint();
    } else if (!frame && current !== target) frame = requestAnimationFrame(tick);
  }

  window.addEventListener('scroll', update, {passive:true});
  window.addEventListener('resize', () => { width = document.documentElement.clientWidth; paint(); update(); }, {passive:true});
  window.addEventListener('pageshow', update);
  document.addEventListener('visibilitychange', update);
  reduce.addEventListener('change', update);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const popover = document.querySelector('#bg-customizer-popover');
    if (popover?.classList.contains('open')) {
      document.querySelector('#btn-close-bg-popover').click();
      document.querySelector('#btn-open-bg-customizer').focus();
    } else {
      const search = document.querySelector('.cmd-search-bar.console-search-open');
      if (search) {
        search.classList.remove('console-search-open');
        document.querySelector('.console-search-button')?.focus();
      }
    }
  });
  current = target = reduce.matches ? Number(window.scrollY > 12) : clamp(window.scrollY / 120);
  paint();

}
