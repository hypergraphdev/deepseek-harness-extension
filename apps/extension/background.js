// Clicking the toolbar icon opens the side panel; no other background work.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  console.error('dsh extension: side panel behavior rejected', error)
})
