import { shellInterfaceService } from '../../features/shell/interface.js';
import { reduceMotion, page } from '../../core/context.js';

  // ── 动效工具：视图错峰入场 / 数字滚动 / 分段滑块 / 复制反馈 ──
  function playViewEnter(){
    if(reduceMotion.matches)return;
    page.classList.remove('view-enter');
    void page.offsetWidth;
    page.classList.add('view-enter');
    setTimeout(()=>page.classList.remove('view-enter'),1050);
  }

  function animateCountUps(root){
    // 先让 displayNumerals 完成「数字 / 单位」分层，再只滚动数字本体：
    // 保持结构不被覆写，避免动画后数字与单位字号失衡。
    shellInterfaceService?.displayNumerals?.();
    if(reduceMotion.matches)return;
    root.querySelectorAll('.sk-val').forEach(el=>{
      const numEl=el.querySelector('.display-number');
      if(!numEl)return;
      const numText=numEl.textContent.trim();
      const target=parseFloat(numText.replace(/,/g,''));
      if(!isFinite(target)||target<=0)return;
      const decimals=(numText.split('.')[1]||'').length, grouped=numText.includes(',');
      const fmtNum=v=>{
        const num=decimals?Number(v.toFixed(decimals)):Math.round(v);
        return grouped?num.toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}):num.toFixed(decimals);
      };
      const t0=performance.now(),dur=560;
      const step=now=>{
        if(!numEl.isConnected)return;
        if(reduceMotion.matches){numEl.textContent=numText;return;}
        const k=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-k,3);
        numEl.textContent=fmtNum(target*e);
        if(k<1)requestAnimationFrame(step);
        else{numEl.textContent=numText;el.classList.add('is-bumping');setTimeout(()=>el.classList.remove('is-bumping'),520)}
      };
      numEl.textContent=fmtNum(0);
      requestAnimationFrame(step);
    });
  }

  function syncSegThumb(group){
    const active=group.querySelector('.seg-item.active');
    let thumb=group.querySelector(':scope > .seg-thumb');
    if(!active){if(thumb)thumb.remove();return}
    if(!thumb){thumb=document.createElement('span');thumb.className='seg-thumb';thumb.setAttribute('aria-hidden','true');group.prepend(thumb)}
    thumb.style.width=active.offsetWidth+'px';
    thumb.style.height=active.offsetHeight+'px';
    thumb.style.transform=`translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  }

  function syncAllSegThumbs(){document.querySelectorAll('.seg-group').forEach(syncSegThumb)}

  async function copyToClipboard(text){
    try{ if(navigator.clipboard?.writeText){ await navigator.clipboard.writeText(text); return true; } }catch{}
    // 无剪贴板权限（或非安全上下文）时退回 execCommand
    try{
      const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
      document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();return ok;
    }catch{return false}
  }
export { playViewEnter, animateCountUps, syncSegThumb, syncAllSegThumbs, copyToClipboard };
