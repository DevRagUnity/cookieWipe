// Background service worker for CookieWipe extension

// Track active tabs and their domains
const activeTabs = new Map();

// Ad block stats per tab
const adBlockStats = new Map();

// Pre-configured tracker cookie domains
const TRACKER_PRESETS = {
  facebook: [
    '*.facebook.com',
    '*.fbcdn.net',
    '*.fbsbx.com',
    '*.facebook.net'
  ],
  instagram: [
    '*.instagram.com',
    '*.cdninstagram.com'
  ],
  amazon: [
    '*.amazon-adsystem.com',
    '*.amazonservices.com',
    '*.assoc-amazon.com'
  ],
  microsoft: [
    '*.clarity.ms',
    '*.bat.bing.com',
    '*.atdmt.com'
  ],
  google: [
    '*.doubleclick.net',
    '*.googlesyndication.com',
    '*.googleadservices.com',
    '*.google-analytics.com',
    '*.googletagmanager.com'
  ],
  twitter: [
    '*.ads.twitter.com',
    '*.analytics.twitter.com',
    '*.t.co'
  ],
  tiktok: [
    '*.analytics.tiktok.com',
    '*.tiktokcdn.com'
  ],
  linkedin: [
    '*.ads.linkedin.com',
    '*.licdn.com'
  ]
};

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('CookieWipe extension installed');

  // Initialize storage with default settings
  chrome.storage.sync.get(
    ['whitelist', 'blacklist', 'enabled', 'cleanupMode', 'adBlockEnabled', 'trackerPresets', 'notificationsEnabled'],
    (result) => {
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
      if (result.adBlockEnabled === undefined) {
        chrome.storage.sync.set({ adBlockEnabled: true });
      }
      if (!result.trackerPresets) {
        // Enable all tracker presets by default
        chrome.storage.sync.set({
          trackerPresets: {
            facebook: true,
            instagram: true,
            amazon: true,
            microsoft: true,
            google: true,
            twitter: true,
            tiktok: true,
            linkedin: true
          }
        });
      }
      if (result.notificationsEnabled === undefined) {
        chrome.storage.sync.set({ notificationsEnabled: true });
      }

      // Initialize ad block stats
      chrome.storage.local.set({ totalAdsBlocked: 0, totalCookiesBlocked: 0 });
    }
  );
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

// Get all active tracker domains from enabled presets
async function getActiveTrackerDomains() {
  const { trackerPresets } = await chrome.storage.sync.get(['trackerPresets']);
  if (!trackerPresets) return [];

  const domains = [];
  for (const [key, enabled] of Object.entries(trackerPresets)) {
    if (enabled && TRACKER_PRESETS[key]) {
      domains.push(...TRACKER_PRESETS[key]);
    }
  }
  return domains;
}

// Check if domain matches any tracker preset
async function isTrackerDomain(domain) {
  const trackerDomains = await getActiveTrackerDomains();
  return isInList(domain, trackerDomains);
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

// Known tracking cookie name patterns
const TRACKING_COOKIE_PATTERNS = [
  /^_fb[cp]$/i,               // Facebook tracking pixels
  /^_fbc$/i,                   // Facebook click ID
  /^_fbp$/i,                   // Facebook browser ID
  /^fr$/i,                     // Facebook ad cookie
  /^_ga/i,                     // Google Analytics
  /^_gid$/i,                   // Google Analytics
  /^_gcl/i,                    // Google conversion linker
  /^_gat/i,                    // Google Analytics throttle
  /^IDE$/i,                    // Google DoubleClick
  /^NID$/i,                    // Google preferences
  /^__gads$/i,                 // Google Adsense
  /^_uet/i,                    // Microsoft UET
  /^MUID$/i,                   // Microsoft user ID
  /^ANONCHK$/i,               // Microsoft clarity
  /^_clck$/i,                  // Microsoft clarity
  /^_clsk$/i,                  // Microsoft clarity
  /^ad-id$/i,                  // Amazon ads
  /^ad-privacy$/i,             // Amazon ads
  /^session-id$/i,             // Amazon session
  /^_pin_unauth$/i,            // Pinterest
  /^_tt_enable_cookie$/i,      // TikTok
  /^_ttp$/i,                   // TikTok pixel
  /^li_sugr$/i,                // LinkedIn
  /^bcookie$/i,                // LinkedIn browser
  /^bscookie$/i,               // LinkedIn secure browser
  /^personalization_id$/i,     // Twitter
  /^guest_id$/i,               // Twitter
  /^ct0$/i,                    // Twitter CSRF
];

// Check if a cookie is a known tracking cookie by name
function isTrackingCookie(cookieName) {
  return TRACKING_COOKIE_PATTERNS.some(pattern => pattern.test(cookieName));
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

  return deletedCount;
}

// Send notification to content script in active tab
async function notifyActiveTab(message, type = 'info') {
  const { notificationsEnabled } = await chrome.storage.sync.get(['notificationsEnabled']);
  if (!notificationsEnabled) return;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0] && tabs[0].id) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'showNotification',
        message: message,
        type: type
      }).catch(() => {
        // Content script may not be loaded yet - that's fine
      });
    }
  } catch (e) {
    // Tab may not support content scripts
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
  } else if (await isTrackerDomain(domain)) {
    badgeColor = '#ff9800'; // Orange for tracker preset
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

  // Clean up ad stats
  adBlockStats.delete(tabId);

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

  // Check if domain is blacklisted or matches tracker presets
  const isBlacklisted = blacklist && isInList(domain, blacklist);
  const isTracker = await isTrackerDomain(domain);

  if (isBlacklisted || isTracker) {
    const reason = isBlacklisted ? 'blacklisted' : 'tracker';
    console.log(`Domain ${domain} is ${reason}, deleting cookies`);
    const count = await deleteCookiesForDomain(domain, retainPreferences);
    if (count > 0) {
      notifyActiveTab(`Cleaned ${count} cookies from ${domain}`, 'success');
    }
  }

  activeTabs.delete(tabId);
});

// Listen for cookie changes
chrome.cookies.onChanged.addListener(async (changeInfo) => {
  // Check if extension is enabled
  const { enabled } = await chrome.storage.sync.get(['enabled']);
  if (!enabled) return;

  // If a cookie was added, check if it's from a blacklisted or tracker domain
  if (!changeInfo.removed && changeInfo.cookie) {
    const { blacklist, cleanupMode } = await chrome.storage.sync.get(['blacklist', 'cleanupMode']);

    const cookieDomain = changeInfo.cookie.domain.startsWith('.')
      ? changeInfo.cookie.domain.slice(1)
      : changeInfo.cookie.domain;

    // Check tracking cookie names (always block known tracker cookies if presets are active)
    const isCookieTracker = isTrackingCookie(changeInfo.cookie.name);
    const isDomainTracker = await isTrackerDomain(cookieDomain);
    const isBlacklisted = blacklist && blacklist.length > 0 && isInList(cookieDomain, blacklist);

    const shouldBlock = isBlacklisted || (isDomainTracker && isCookieTracker);

    if (shouldBlock && cleanupMode === 'immediate') {
      console.log(`Blocking cookie "${changeInfo.cookie.name}" from ${cookieDomain}`);

      const url = `http${changeInfo.cookie.secure ? 's' : ''}://${changeInfo.cookie.domain}${changeInfo.cookie.path}`;
      try {
        await chrome.cookies.remove({
          url: url,
          name: changeInfo.cookie.name,
          storeId: changeInfo.cookie.storeId
        });

        // Update stats
        const { totalCookiesBlocked } = await chrome.storage.local.get(['totalCookiesBlocked']);
        await chrome.storage.local.set({ totalCookiesBlocked: (totalCookiesBlocked || 0) + 1 });

        // Notify (throttled - only show periodically)
        const newTotal = (totalCookiesBlocked || 0) + 1;
        if (newTotal % 5 === 1) {
          notifyActiveTab(`Blocked tracking cookie from ${cookieDomain}`, 'blocked');
        }
      } catch (error) {
        console.error('Error deleting cookie:', error);
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

// Listen for ad requests blocked by declarativeNetRequest
if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
    const tabId = info.request.tabId;
    if (tabId > 0) {
      const current = adBlockStats.get(tabId) || 0;
      adBlockStats.set(tabId, current + 1);

      // Update global counter
      const { totalAdsBlocked } = await chrome.storage.local.get(['totalAdsBlocked']);
      await chrome.storage.local.set({ totalAdsBlocked: (totalAdsBlocked || 0) + 1 });
    }
  });
}

// Listen for storage changes to update badge colors
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'sync' && (changes.whitelist || changes.blacklist || changes.trackerPresets)) {
    // Update badges for all tabs when lists change
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url) {
        updateBadge(tab.id, tab.url);
      }
    }
  }

  // Toggle declarativeNetRequest rules when ad blocker is toggled
  if (areaName === 'sync' && changes.adBlockEnabled) {
    const enabled = changes.adBlockEnabled.newValue;
    try {
      if (enabled) {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: ['adblock_rules']
        });
      } else {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          disableRulesetIds: ['adblock_rules']
        });
      }
    } catch (e) {
      console.error('Error toggling ad block rules:', e);
    }
  }
});

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getCookieCount') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0] && tabs[0].url) {
        const domain = getDomainFromUrl(tabs[0].url);
        if (domain) {
          try {
            const cookies = await chrome.cookies.getAll({ domain: domain });
            const cookiesWithDot = await chrome.cookies.getAll({ domain: `.${domain}` });
            const allCookies = [...cookies, ...cookiesWithDot];

            // Classify cookies
            const trackingCookies = allCookies.filter(c => isTrackingCookie(c.name));
            const isTracker = await isTrackerDomain(domain);

            sendResponse({
              count: allCookies.length,
              domain: domain,
              cookies: allCookies,
              trackingCount: trackingCookies.length,
              isTrackerDomain: isTracker
            });
          } catch (error) {
            console.error('Error getting cookies:', error);
            sendResponse({ count: 0, domain: domain, cookies: [], trackingCount: 0, isTrackerDomain: false });
          }
        } else {
          sendResponse({ count: 0, domain: null, cookies: [], trackingCount: 0, isTrackerDomain: false });
        }
      } else {
        sendResponse({ count: 0, domain: null, cookies: [], trackingCount: 0, isTrackerDomain: false });
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
          const count = await deleteCookiesForDomain(domain, retainPreferences);
          notifyActiveTab(`Deleted ${count} cookies from ${domain}`, 'success');
          sendResponse({ success: true, deletedCount: count });
        } else {
          sendResponse({ success: false, error: 'No valid domain' });
        }
      } else {
        sendResponse({ success: false, error: 'No active tab' });
      }
    });
    return true;
  }

  if (request.action === 'getStats') {
    (async () => {
      const stats = await chrome.storage.local.get(['totalAdsBlocked', 'totalCookiesBlocked']);
      sendResponse({
        totalAdsBlocked: stats.totalAdsBlocked || 0,
        totalCookiesBlocked: stats.totalCookiesBlocked || 0
      });
    })();
    return true;
  }

  if (request.action === 'getTrackerPresets') {
    sendResponse({ presets: TRACKER_PRESETS });
    return true;
  }

  if (request.action === 'adBlockStats') {
    // Received from content script
    if (sender.tab) {
      adBlockStats.set(sender.tab.id, request.adsBlocked || 0);
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'cleanTrackerCookies') {
    (async () => {
      const trackerDomains = await getActiveTrackerDomains();
      let totalDeleted = 0;

      for (const pattern of trackerDomains) {
        const domain = pattern.startsWith('*.') ? pattern.slice(2) : pattern;
        try {
          const count = await deleteCookiesForDomain(domain, false);
          totalDeleted += count;
        } catch (e) {
          console.error(`Error cleaning tracker cookies for ${domain}:`, e);
        }
      }

      notifyActiveTab(`Cleaned ${totalDeleted} tracking cookies`, 'success');
      sendResponse({ success: true, deletedCount: totalDeleted });
    })();
    return true;
  }
});
