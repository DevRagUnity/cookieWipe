// Background service worker for Cookiez extension

// Track active tabs and their domains
const activeTabs = new Map();

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('CookieWipe extension installed');

  // Initialize storage with default settings
  chrome.storage.sync.get(['whitelist', 'blacklist', 'enabled', 'cleanupMode'], (result) => {
    if (!result.whitelist) {
      chrome.storage.sync.set({ whitelist: [] });
    }
    if (!result.blacklist) {
      chrome.storage.sync.set({ blacklist: [] });
    }
    if (result.enabled === undefined) {
      chrome.storage.sync.set({ enabled: true });
    }
    if (!result.cleanupMode) {
      chrome.storage.sync.set({ cleanupMode: 'immediate' });
    }
  });
});

// Extract domain from URL
function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (e) {
    return null;
  }
}

// Check if domain matches pattern (supports wildcards)
function matchesDomain(domain, pattern) {
  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.slice(2);
    return domain.endsWith(baseDomain) || domain === baseDomain.slice(0, -1);
  }
  return domain === pattern;
}

// Check if domain is in list
function isInList(domain, list) {
  return list.some(pattern => matchesDomain(domain, pattern));
}

// Common cookie names that store site preferences
const PREFERENCE_COOKIE_PATTERNS = [
  /^(theme|dark.?mode|light.?mode)$/i,
  /^(lang|language|locale|i18n)$/i,
  /^(timezone|tz)$/i,
  /^(cookie.?consent|cookie.?accept|gdpr)$/i,
  /^(font.?size|text.?size)$/i,
  /^(layout|view.?mode|display.?mode)$/i,
  /^(preferences|prefs|settings)$/i,
  /^(accessibility|a11y)$/i,
];

// Check if a cookie is a preference cookie
function isPreferenceCookie(cookieName) {
  return PREFERENCE_COOKIE_PATTERNS.some(pattern => pattern.test(cookieName));
}

// Delete all cookies for a domain
async function deleteCookiesForDomain(domain, retainPreferences = false) {
  const cookies = await chrome.cookies.getAll({ domain: domain });
  const cookiesWithDot = await chrome.cookies.getAll({ domain: `.${domain}` });
  const allCookies = [...cookies, ...cookiesWithDot];

  const deletePromises = allCookies
    .filter(cookie => !retainPreferences || !isPreferenceCookie(cookie.name))
    .map(cookie => {
      const url = `http${cookie.secure ? 's' : ''}://${cookie.domain}${cookie.path}`;
      return chrome.cookies.remove({
        url: url,
        name: cookie.name,
        storeId: cookie.storeId
      });
    });

  await Promise.all(deletePromises);

  const deletedCount = deletePromises.length;
  const retainedCount = allCookies.length - deletedCount;

  if (retainPreferences && retainedCount > 0) {
    console.log(`Deleted ${deletedCount} cookies for domain: ${domain}, retained ${retainedCount} preference cookies`);
  } else {
    console.log(`Deleted ${deletedCount} cookies for domain: ${domain}`);
  }
}

// Update badge with cookie count for current tab
async function updateBadge(tabId, url) {
  const domain = getDomainFromUrl(url);
  if (!domain) return;

  const cookies = await chrome.cookies.getAll({ domain: domain });
  const cookiesWithDot = await chrome.cookies.getAll({ domain: `.${domain}` });
  const totalCount = cookies.length + cookiesWithDot.length;

  // Get whitelist and blacklist to determine badge color
  const { whitelist, blacklist } = await chrome.storage.sync.get(['whitelist', 'blacklist']);

  let badgeColor = '#2196F3'; // Default blue (neutral)

  if (whitelist && isInList(domain, whitelist)) {
    badgeColor = '#4CAF50'; // Green for whitelisted
  } else if (blacklist && isInList(domain, blacklist)) {
    badgeColor = '#f44336'; // Red for blacklisted
  }

  chrome.action.setBadgeText({
    tabId: tabId,
    text: totalCount > 0 ? totalCount.toString() : ''
  });

  chrome.action.setBadgeBackgroundColor({
    tabId: tabId,
    color: badgeColor
  });
}

// Listen for tab updates (URL changes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const domain = getDomainFromUrl(changeInfo.url);
    if (domain) {
      activeTabs.set(tabId, domain);
      updateBadge(tabId, changeInfo.url);
    }
  }
});

// Listen for tab activation (switching tabs)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url) {
    const domain = getDomainFromUrl(tab.url);
    if (domain) {
      activeTabs.set(activeInfo.tabId, domain);
      updateBadge(activeInfo.tabId, tab.url);
    }
  }
});

// Listen for tab removal (closing tabs)
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const domain = activeTabs.get(tabId);
  if (!domain) return;

  // Check if extension is enabled
  const { enabled } = await chrome.storage.sync.get(['enabled']);
  if (!enabled) return;

  // Get whitelist, blacklist, and retain preferences setting
  const { whitelist, blacklist, retainPreferences } = await chrome.storage.sync.get(['whitelist', 'blacklist', 'retainPreferences']);

  // Check if domain is whitelisted
  if (whitelist && isInList(domain, whitelist)) {
    console.log(`Domain ${domain} is whitelisted, keeping cookies`);
    activeTabs.delete(tabId);
    return;
  }

  // Check if domain is blacklisted
  if (blacklist && isInList(domain, blacklist)) {
    console.log(`Domain ${domain} is blacklisted, deleting cookies`);
    await deleteCookiesForDomain(domain, retainPreferences);
  }

  activeTabs.delete(tabId);
});

// Listen for cookie changes
chrome.cookies.onChanged.addListener(async (changeInfo) => {
  console.log('Cookie changed:', changeInfo);

  // Check if extension is enabled
  const { enabled } = await chrome.storage.sync.get(['enabled']);
  if (!enabled) return;

  // If a cookie was added, check if it's from a blacklisted domain
  if (!changeInfo.removed && changeInfo.cookie) {
    const { blacklist, cleanupMode } = await chrome.storage.sync.get(['blacklist', 'cleanupMode']);

    // Only delete immediately if cleanup mode is 'immediate'
    if (blacklist && blacklist.length > 0 && cleanupMode === 'immediate') {
      const cookieDomain = changeInfo.cookie.domain.startsWith('.')
        ? changeInfo.cookie.domain.slice(1)
        : changeInfo.cookie.domain;

      // Check if this cookie's domain matches any blacklist pattern
      if (isInList(cookieDomain, blacklist)) {
        console.log(`Cookie from blacklisted domain ${cookieDomain}, deleting immediately`);

        // Delete the cookie immediately
        const url = `http${changeInfo.cookie.secure ? 's' : ''}://${changeInfo.cookie.domain}${changeInfo.cookie.path}`;
        try {
          await chrome.cookies.remove({
            url: url,
            name: changeInfo.cookie.name,
            storeId: changeInfo.cookie.storeId
          });
        } catch (error) {
          console.error('Error deleting cookie:', error);
        }
      }
    }
  }

  // Update badge for all tabs that match the cookie's domain
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url) {
      const domain = getDomainFromUrl(tab.url);
      if (domain && changeInfo.cookie.domain.includes(domain)) {
        updateBadge(tab.id, tab.url);
      }
    }
  }
});

// Listen for storage changes to update badge colors
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'sync' && (changes.whitelist || changes.blacklist)) {
    // Update badges for all tabs when lists change
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url) {
        updateBadge(tab.id, tab.url);
      }
    }
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getCookieCount') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0] && tabs[0].url) {
        const domain = getDomainFromUrl(tabs[0].url);
        if (domain) {
          try {
            const cookies = await chrome.cookies.getAll({ domain: domain });
            const cookiesWithDot = await chrome.cookies.getAll({ domain: `.${domain}` });
            sendResponse({
              count: cookies.length + cookiesWithDot.length,
              domain: domain,
              cookies: [...cookies, ...cookiesWithDot]
            });
          } catch (error) {
            console.error('Error getting cookies:', error);
            sendResponse({ count: 0, domain: domain, cookies: [] });
          }
        } else {
          sendResponse({ count: 0, domain: null, cookies: [] });
        }
      } else {
        sendResponse({ count: 0, domain: null, cookies: [] });
      }
    });
    return true; // Keep channel open for async response
  }

  if (request.action === 'deleteCookiesNow') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0] && tabs[0].url) {
        const domain = getDomainFromUrl(tabs[0].url);
        if (domain) {
          const { retainPreferences } = await chrome.storage.sync.get(['retainPreferences']);
          await deleteCookiesForDomain(domain, retainPreferences);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No valid domain' });
        }
      } else {
        sendResponse({ success: false, error: 'No active tab' });
      }
    });
    return true;
  }
});
