window.LOCALDNS_UI_CONFIG = {
  apiBase: "",
  // Optional UI update endpoint; populated by install_ui_updater.py. No credentials here.
  uiUpdaterBase: "",
  // Optional configuration backend root; empty uses the DNS API host on port 9098.
  proxyConfigBase: "",

  title: "LocalDNS 控制台",
  refreshInterval: 30,
  requestTimeout: 10000,
  demoOnApiFailure: false
};
