let charts = [];
export function takeCharts(){ return charts.splice(0); }
export function restoreCharts(previous){ charts = previous.concat(charts); }

  function destroyCharts(){ charts.forEach(c=>{try{c.destroy()}catch{}}); charts=[]; }

  function chart(el, cfg){ if(!window.Chart||!el)return null; const c=new window.Chart(el,cfg); charts.push(c); return c; }

  function chartColors(){ const css=getComputedStyle(document.documentElement); return {primary:css.getPropertyValue('--primary').trim(),green:css.getPropertyValue('--green').trim(),orange:css.getPropertyValue('--orange').trim(),pink:css.getPropertyValue('--pink').trim(),cyan:css.getPropertyValue('--cyan').trim(),muted:css.getPropertyValue('--muted').trim(),border:css.getPropertyValue('--border').trim(),text:css.getPropertyValue('--text-2').trim(),surface:css.getPropertyValue('--surface-2').trim()}; }
export { destroyCharts, chart, chartColors };
