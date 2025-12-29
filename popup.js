// Popup script for Cookiez extension

let currentDomain = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await updateCookieCount();
  setupEventListeners();
});

// Load settings from storage
async function loadSettings() {
  const result = await chrome.storage.sync.get(['whitelist', 'blacklist', 'enabled', 'cleanupMode', 'retainPreferences']);

  const whitelist = result.whitelist || [];
  const blacklist = result.blacklist || [];
  const enabled = result.enabled !== undefined ? result.enabled : true;
  const cleanupMode = result.cleanupMode || 'immediate';
  const retainPreferences = result.retainPreferences !== undefined ? result.retainPreferences : false;

  // Update toggle
  document.getElementById('enableToggle').checked = enabled;
  updateStatusText(enabled);

  // Update cleanup mode radio buttons
  const radios = document.querySelectorAll('input[name="cleanupMode"]');
  radios.forEach(radio => {
    if (radio.value === cleanupMode) {
      radio.checked = true;
    }
  });

  // Update retain preferences checkbox
  document.getElementById('retainPreferences').checked = retainPreferences;

  // Display lists
  displayList('whitelist', whitelist);
  displayList('blacklist', blacklist);
}

// Update status text
function updateStatusText(enabled) {
  document.getElementById('statusText').textContent = enabled ? 'Enabled' : 'Disabled';
  document.getElementById('statusText').style.color = enabled ? '#4CAF50' : '#f44336';
}

// Display domain list
function displayList(type, domains) {
  const listElement = document.getElementById(`${type}List`);
  listElement.innerHTML = '';

  if (domains.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'empty-message';
    emptyItem.textContent = `No ${type}ed domains`;
    listElement.appendChild(emptyItem);
    return;
  }

  domains.forEach(domain => {
    const li = document.createElement('li');
    li.className = 'domain-item';

    const domainText = document.createElement('span');
    domainText.textContent = domain;
    domainText.className = 'domain-text';

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.className = 'btn-remove';
    removeBtn.onclick = () => removeDomain(type, domain);

    li.appendChild(domainText);
    li.appendChild(removeBtn);
    listElement.appendChild(li);
  });
}

// Add domain to list
async function addDomain(type, domain) {
  if (!domain || domain.trim() === '') {
    alert('Please enter a domain');
    return;
  }

  domain = domain.trim().toLowerCase();

  // Validate domain format
  if (!isValidDomain(domain)) {
    alert('Invalid domain format. Use example.com or *.example.com');
    return;
  }

  const result = await chrome.storage.sync.get([type]);
  const list = result[type] || [];

  if (list.includes(domain)) {
    alert(`Domain already in ${type}`);
    return;
  }

  list.push(domain);
  await chrome.storage.sync.set({ [type]: list });
  displayList(type, list);

  // Clear input
  document.getElementById(`${type}Input`).value = '';
}

// Remove domain from list
async function removeDomain(type, domain) {
  const result = await chrome.storage.sync.get([type]);
  let list = result[type] || [];

  list = list.filter(d => d !== domain);
  await chrome.storage.sync.set({ [type]: list });
  displayList(type, list);
}

// Validate domain format
function isValidDomain(domain) {
  const domainRegex = /^(\*\.)?[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
  return domainRegex.test(domain);
}

// Update cookie count
async function updateCookieCount() {
  chrome.runtime.sendMessage({ action: 'getCookieCount' }, async (response) => {
    if (response) {
      document.getElementById('cookieCount').textContent = response.count;
      document.getElementById('currentDomain').textContent = response.domain || 'No domain';
      currentDomain = response.domain;

      // Update status badge
      await updateStatusBadge(response.domain);

      // Display cookie details
      displayCookieDetails(response.cookies);
    }
  });
}

// Update status badge to show if domain is whitelisted/blacklisted
async function updateStatusBadge(domain) {
  const statusBadge = document.getElementById('statusBadge');

  if (!domain) {
    statusBadge.textContent = '';
    statusBadge.className = 'status-badge';
    return;
  }

  const result = await chrome.storage.sync.get(['whitelist', 'blacklist']);
  const whitelist = result.whitelist || [];
  const blacklist = result.blacklist || [];

  // Check if domain matches any pattern
  const isWhitelisted = whitelist.some(pattern => matchesDomain(domain, pattern));
  const isBlacklisted = blacklist.some(pattern => matchesDomain(domain, pattern));

  if (isWhitelisted) {
    statusBadge.textContent = 'Whitelisted';
    statusBadge.className = 'status-badge whitelisted';
  } else if (isBlacklisted) {
    statusBadge.textContent = 'Blacklisted';
    statusBadge.className = 'status-badge blacklisted';
  } else {
    statusBadge.textContent = 'Neutral';
    statusBadge.className = 'status-badge neutral';
  }
}

// Check if domain matches pattern (same logic as background.js)
function matchesDomain(domain, pattern) {
  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.slice(2);
    return domain.endsWith(baseDomain) || domain === baseDomain.slice(0, -1);
  }
  return domain === pattern;
}

// Display cookie details
function displayCookieDetails(cookies) {
  const detailsList = document.getElementById('cookieDetailsList');
  detailsList.innerHTML = '';

  if (cookies.length === 0) {
    detailsList.innerHTML = '<div class="empty-message">No cookies found</div>';
    return;
  }

  cookies.forEach(cookie => {
    const cookieItem = document.createElement('div');
    cookieItem.className = 'cookie-item';

    const cookieName = document.createElement('div');
    cookieName.className = 'cookie-name';
    cookieName.textContent = cookie.name;

    const cookieInfo = document.createElement('div');
    cookieInfo.className = 'cookie-info-text';
    cookieInfo.innerHTML = `
      <span>Domain: ${cookie.domain}</span>
      <span>Path: ${cookie.path}</span>
      <span>Secure: ${cookie.secure ? 'Yes' : 'No'}</span>
      <span>HttpOnly: ${cookie.httpOnly ? 'Yes' : 'No'}</span>
    `;

    cookieItem.appendChild(cookieName);
    cookieItem.appendChild(cookieInfo);
    detailsList.appendChild(cookieItem);
  });
}

// Setup event listeners
function setupEventListeners() {
  // Enable/disable toggle
  document.getElementById('enableToggle').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await chrome.storage.sync.set({ enabled });
    updateStatusText(enabled);
  });

  // Cleanup mode radio buttons
  document.querySelectorAll('input[name="cleanupMode"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const cleanupMode = e.target.value;
      await chrome.storage.sync.set({ cleanupMode });
      console.log(`Cleanup mode changed to: ${cleanupMode}`);
    });
  });

  // Retain preferences checkbox
  document.getElementById('retainPreferences').addEventListener('change', async (e) => {
    const retainPreferences = e.target.checked;
    await chrome.storage.sync.set({ retainPreferences });
    console.log(`Retain preferences: ${retainPreferences}`);
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });

  // Add to whitelist
  document.getElementById('addWhitelist').addEventListener('click', () => {
    const domain = document.getElementById('whitelistInput').value;
    addDomain('whitelist', domain);
  });

  document.getElementById('whitelistInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const domain = document.getElementById('whitelistInput').value;
      addDomain('whitelist', domain);
    }
  });

  // Add to blacklist
  document.getElementById('addBlacklist').addEventListener('click', () => {
    const domain = document.getElementById('blacklistInput').value;
    addDomain('blacklist', domain);
  });

  document.getElementById('blacklistInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const domain = document.getElementById('blacklistInput').value;
      addDomain('blacklist', domain);
    }
  });

  // Add current domain buttons
  document.getElementById('addCurrentToWhitelist').addEventListener('click', () => {
    if (currentDomain) {
      addDomain('whitelist', currentDomain);
    } else {
      alert('No domain detected for current tab');
    }
  });

  document.getElementById('addCurrentToBlacklist').addEventListener('click', () => {
    if (currentDomain) {
      addDomain('blacklist', currentDomain);
    } else {
      alert('No domain detected for current tab');
    }
  });

  // Delete cookies now button
  document.getElementById('deleteNow').addEventListener('click', async () => {
    chrome.runtime.sendMessage({ action: 'deleteCookiesNow' }, (response) => {
      if (response && response.success) {
        setTimeout(() => updateCookieCount(), 100);
      } else if (response && response.error) {
        console.error('Failed to delete cookies:', response.error);
      }
    });
  });
}

// Switch tabs
function switchTab(tabName) {
  // Update buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

  // Update content
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });
  document.getElementById(`${tabName}-tab`).classList.add('active');
}

// Refresh cookie count periodically
setInterval(updateCookieCount, 2000);
