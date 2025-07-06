document.addEventListener('DOMContentLoaded', async () => {
  const menuToggle = document.getElementById('toggle-menu');
  const indicatorsToggle = document.getElementById('toggle-indicators');

  // Status aus dem Storage laden
  const status = await chrome.storage.local.get(['menuVisible', 'indicatorsVisible']);
  menuToggle.checked = status.menuVisible ?? true;
  indicatorsToggle.checked = status.indicatorsVisible ?? false;

  // Menu Toggle Handler
  menuToggle.addEventListener('change', async () => {
    const isVisible = menuToggle.checked;
    await chrome.storage.local.set({ menuVisible: isVisible });
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { 
      type: "TOGGLE_MENU", 
      visible: isVisible 
    });
  });

  // Indikatoren Toggle Handler
  indicatorsToggle.addEventListener('change', async () => {
    const isVisible = indicatorsToggle.checked;
    await chrome.storage.local.set({ indicatorsVisible: isVisible });
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { 
      type: "TOGGLE_INDICATORS", 
      visible: isVisible 
    });
  });
});