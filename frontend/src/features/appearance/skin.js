import { shellInterfaceService } from '../shell/interface.js';
import { preferences } from '../../core/persistence/preferences.ts';
export let skinService;
export function initialize() {

  'use strict';
  const STORAGE_KEY = 'localdns-skin-v1';
  const CLAUDE_PRESET_LABELS = {
    parchment: '经典羊皮纸',
    terracotta: '暖陶宣纸',
    sage: '鼠尾草笺',
    ivory: '纯粹原白',
    obsidian: '夜读黑曜'
  };

  const defaults = () => ({
    active: 'claude',
    claude: {
      preset: 'parchment',
      lastLightPreset: 'parchment',
      grain: 22,
      warmth: 48,
      theme: 'light-glass'
    },
    glass: {
      theme: 'cosmos-glass'
    }
  });

  function readPrefs() {
    const base = defaults();
    try {
      const raw = JSON.parse(preferences.getItem(STORAGE_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return base;
      const active = raw.active === 'glass' ? 'glass' : 'claude';
      const claude = { ...base.claude, ...(raw.claude || {}) };
      if (!Object.hasOwn(CLAUDE_PRESET_LABELS, claude.preset)) claude.preset = 'parchment';
      if (!Object.hasOwn(CLAUDE_PRESET_LABELS, claude.lastLightPreset) || claude.lastLightPreset === 'obsidian') {
        claude.lastLightPreset = 'parchment';
      }
      claude.grain = Math.max(0, Math.min(60, Number.isFinite(+claude.grain) ? +claude.grain : 22));
      claude.warmth = Math.max(0, Math.min(100, Number.isFinite(+claude.warmth) ? +claude.warmth : 48));
      claude.theme = claude.theme === 'cosmos-glass' ? 'cosmos-glass' : 'light-glass';
      const glass = { ...base.glass, ...(raw.glass || {}) };
      glass.theme = glass.theme === 'light-glass' ? 'light-glass' : 'cosmos-glass';
      return { active, claude, glass };
    } catch {
      return base;
    }
  }

  let prefs = readPrefs();

  const normalizeTheme = value => value === 'light-glass' ? 'light-glass' : 'cosmos-glass';

  function savePrefs() {
    try {
      preferences.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {}
  }

  function applyRootAttributes() {
    const root = document.documentElement;
    root.dataset.skin = prefs.active;
    root.dataset.claudePreset = prefs.claude.preset;
    root.style.setProperty('--paper-grain', (prefs.claude.grain / 100).toFixed(2));
    root.style.setProperty('--paper-warmth', (prefs.claude.warmth / 100).toFixed(2));
  }

  // Initial restore before paint
  applyRootAttributes();
  try {
    const existingTheme = preferences.getItem('localdnsTheme');
    const hasSkinPrefs = !!preferences.getItem(STORAGE_KEY);
    const activeTheme = prefs.active === 'claude' ? prefs.claude.theme : prefs.glass.theme;
    const initialTheme = hasSkinPrefs
      ? normalizeTheme(activeTheme)
      : normalizeTheme(existingTheme || activeTheme);
    document.documentElement.dataset.theme = initialTheme;
    if (!existingTheme) preferences.setItem('localdnsTheme', initialTheme);
  } catch {
    document.documentElement.dataset.theme = prefs.active === 'claude' ? prefs.claude.theme : prefs.glass.theme;
  }

  function syncControls() {
    const isClaude = prefs.active === 'claude';
    document.querySelectorAll('[data-skin-switch]').forEach(btn => {
      const match = btn.dataset.skinSwitch === prefs.active;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-pressed', String(match));
    });
    document.querySelectorAll('[data-skin-select]').forEach(card => {
      const match = card.dataset.skinSelect === prefs.active;
      card.classList.toggle('active', match);
      card.setAttribute('aria-checked', String(match));
    });
    document.querySelectorAll('.preset-btn[data-claude-preset]').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.claudePreset === prefs.claude.preset);
    });
    const presetLabel = document.querySelector('#val-claude-preset');
    if (presetLabel) presetLabel.textContent = CLAUDE_PRESET_LABELS[prefs.claude.preset] || '经典羊皮纸';

    const grainSlider = document.querySelector('#slider-paper-grain');
    const grainVal = document.querySelector('#val-paper-grain');
    if (grainSlider && +grainSlider.value !== prefs.claude.grain) grainSlider.value = String(prefs.claude.grain);
    if (grainVal) grainVal.textContent = `${prefs.claude.grain}%`;

    const warmthSlider = document.querySelector('#slider-paper-warmth');
    const warmthVal = document.querySelector('#val-paper-warmth');
    if (warmthSlider && +warmthSlider.value !== prefs.claude.warmth) warmthSlider.value = String(prefs.claude.warmth);
    if (warmthVal) warmthVal.textContent = `${prefs.claude.warmth}%`;

    const titleSpan = document.querySelector('.bcp-title > span');
    if (titleSpan) {
      titleSpan.textContent = isClaude ? '外观与皮肤 · 人文羊皮纸' : '外观与皮肤 · 流光毛玻璃';
    }
  }

  function applyTheme(nextTheme) {
    const theme = normalizeTheme(nextTheme);
    prefs[prefs.active].theme = theme;
    if (prefs.active === 'claude') {
      if (theme === 'cosmos-glass' && prefs.claude.preset !== 'obsidian') {
        prefs.claude.lastLightPreset = prefs.claude.preset;
        prefs.claude.preset = 'obsidian';
      } else if (theme === 'light-glass' && prefs.claude.preset === 'obsidian') {
        prefs.claude.preset = prefs.claude.lastLightPreset || 'parchment';
      }
      document.documentElement.dataset.claudePreset = prefs.claude.preset;
    }
    document.documentElement.dataset.theme = theme;
    try { preferences.setItem('localdnsTheme', theme); } catch {}
    applyRootAttributes();
    savePrefs();
    syncControls();
    shellInterfaceService?.updateBrand?.();
    window.dispatchEvent(new CustomEvent('localdns:themechange', { detail: { skin: prefs.active, theme } }));
  }

  function toggleTheme() {
    const current = normalizeTheme(document.documentElement.dataset.theme);
    applyTheme(current === 'light-glass' ? 'cosmos-glass' : 'light-glass');
  }

  function setSkin(nextSkin) {
    if (nextSkin !== 'claude' && nextSkin !== 'glass') return;
    const root = document.documentElement;
    const curTheme = root.dataset.theme === 'light-glass' ? 'light-glass' : 'cosmos-glass';
    prefs[prefs.active].theme = curTheme;

    prefs.active = nextSkin;
    const targetTheme = normalizeTheme(prefs[nextSkin].theme || (nextSkin === 'claude' ? 'light-glass' : 'cosmos-glass'));
    applyTheme(targetTheme);
    window.dispatchEvent(new CustomEvent('localdns:skinchange', { detail: { skin: nextSkin, theme: targetTheme } }));
  }

  function setClaudePreset(preset) {
    if (!Object.hasOwn(CLAUDE_PRESET_LABELS, preset)) return;
    prefs.claude.preset = preset;
    if (preset !== 'obsidian') {
      prefs.claude.lastLightPreset = preset;
      prefs.claude.theme = 'light-glass';
    } else {
      prefs.claude.theme = 'cosmos-glass';
    }
    applyTheme(prefs.claude.theme);
    window.dispatchEvent(new CustomEvent('localdns:skinchange', { detail: { skin: prefs.active, theme: prefs.claude.theme } }));
  }

  function init() {
    document.querySelectorAll('[data-skin-switch]').forEach(btn => {
      btn.addEventListener('click', () => setSkin(btn.dataset.skinSwitch));
    });
    document.querySelectorAll('[data-skin-select]').forEach(card => {
      card.addEventListener('click', () => setSkin(card.dataset.skinSelect));
    });
    document.querySelectorAll('.preset-btn[data-claude-preset]').forEach(sw => {
      sw.addEventListener('click', () => setClaudePreset(sw.dataset.claudePreset));
    });

    const grainSlider = document.querySelector('#slider-paper-grain');
    if (grainSlider) {
      grainSlider.addEventListener('input', () => {
        prefs.claude.grain = +grainSlider.value;
        applyRootAttributes();
        syncControls();
        savePrefs();
      });
    }

    const warmthSlider = document.querySelector('#slider-paper-warmth');
    if (warmthSlider) {
      warmthSlider.addEventListener('input', () => {
        prefs.claude.warmth = +warmthSlider.value;
        applyRootAttributes();
        syncControls();
        savePrefs();
      });
    }

    // Delegate from the document so the theme control keeps working if the shell
    // refreshes or replaces the header node during a route update.
    document.addEventListener('click', event => {
      if (event.target.closest?.('#theme-toggle')) {
        event.preventDefault();
        toggleTheme();
      }
    }, true);
    document.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.id === 'theme-toggle') {
        event.preventDefault();
        toggleTheme();
      }
    }, true);

    // Observe data-theme changes from #theme-toggle so Claude preset & per-skin theme stay in sync
    new MutationObserver(() => {
      const theme = normalizeTheme(document.documentElement.dataset.theme);
      prefs[prefs.active].theme = theme;
      if (prefs.active === 'claude') {
        if (theme === 'cosmos-glass' && prefs.claude.preset !== 'obsidian') {
          prefs.claude.preset = 'obsidian';
        } else if (theme === 'light-glass' && prefs.claude.preset === 'obsidian') {
          prefs.claude.preset = prefs.claude.lastLightPreset || 'parchment';
        }
        document.documentElement.dataset.claudePreset = prefs.claude.preset;
      }
      savePrefs();
      syncControls();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    syncControls();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  skinService = { setSkin, setClaudePreset, toggleTheme, getSkin: () => prefs.active };

}
