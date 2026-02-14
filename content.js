// CookieWipe Content Script - Ad Element Hiding & Notification Overlay

(function () {
  'use strict';

  // Common ad element CSS selectors to hide
  const AD_SELECTORS = [
    // Google Ads
    'ins.adsbygoogle',
    '[id^="google_ads"]',
    '[id^="div-gpt-ad"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    // Generic ad containers
    '[class*="ad-banner"]',
    '[class*="ad-container"]',
    '[class*="ad-wrapper"]',
    '[id*="ad-banner"]',
    '[id*="ad-container"]',
    '[id*="ad-wrapper"]',
    '[data-ad]',
    '[data-ad-slot]',
    '[data-ad-client]',
    // Sponsored content
    '[class*="sponsored-content"]',
    '[class*="sponsored_content"]',
    // Taboola / Outbrain
    '[id*="taboola"]',
    '[class*="taboola"]',
    '[id*="outbrain"]',
    '[class*="outbrain"]',
    '.OUTBRAIN',
    // Common ad iframes
    'iframe[src*="amazon-adsystem.com"]',
    'iframe[src*="facebook.com/plugins"]',
    'iframe[src*="ads"]',
  ];

  let adBlockEnabled = true;
  let adsBlocked = 0;

  // Load ad blocker state from storage
  chrome.storage.sync.get(['adBlockEnabled'], (result) => {
    adBlockEnabled = result.adBlockEnabled !== undefined ? result.adBlockEnabled : true;
    if (adBlockEnabled) {
      hideAdElements();
      observeDOM();
    }
  });

  // Listen for setting changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.adBlockEnabled) {
      adBlockEnabled = changes.adBlockEnabled.newValue;
      if (adBlockEnabled) {
        hideAdElements();
        observeDOM();
      }
    }
  });

  // Hide existing ad elements on the page
  function hideAdElements() {
    if (!adBlockEnabled) return;

    const selector = AD_SELECTORS.join(', ');
    const adElements = document.querySelectorAll(selector);

    adElements.forEach((el) => {
      if (!el.dataset.cwHidden) {
        el.style.setProperty('display', 'none', 'important');
        el.dataset.cwHidden = 'true';
        adsBlocked++;
      }
    });

    if (adsBlocked > 0) {
      reportStats();
    }
  }

  // Watch for dynamically inserted ad elements
  let observer = null;
  function observeDOM() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (!adBlockEnabled) return;

      let found = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node itself is an ad
            const selector = AD_SELECTORS.join(', ');
            if (node.matches && node.matches(selector)) {
              node.style.setProperty('display', 'none', 'important');
              node.dataset.cwHidden = 'true';
              adsBlocked++;
              found = true;
            }
            // Check children of the added node
            const childAds = node.querySelectorAll
              ? node.querySelectorAll(selector)
              : [];
            childAds.forEach((el) => {
              if (!el.dataset.cwHidden) {
                el.style.setProperty('display', 'none', 'important');
                el.dataset.cwHidden = 'true';
                adsBlocked++;
                found = true;
              }
            });
          }
        }
      }

      if (found) {
        reportStats();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // Report blocked count to background
  function reportStats() {
    chrome.runtime.sendMessage({
      action: 'adBlockStats',
      adsBlocked: adsBlocked,
    });
  }

  // ---- Non-obstructive Notification System ----

  let notificationContainer = null;
  let notificationTimeout = null;

  function ensureNotificationContainer() {
    if (notificationContainer && document.body.contains(notificationContainer)) {
      return notificationContainer;
    }

    notificationContainer = document.createElement('div');
    notificationContainer.id = 'cookiewipe-notifications';
    notificationContainer.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    document.body.appendChild(notificationContainer);
    return notificationContainer;
  }

  function showNotification(message, type = 'info') {
    const container = ensureNotificationContainer();

    const colors = {
      info: { bg: '#4f46e5', text: '#ffffff', icon: '\u{1F6E1}' },
      success: { bg: '#16a34a', text: '#ffffff', icon: '\u2713' },
      warning: { bg: '#ea580c', text: '#ffffff', icon: '\u26A0' },
      blocked: { bg: '#ef4444', text: '#ffffff', icon: '\u{1F6AB}' },
    };

    const color = colors[type] || colors.info;

    const notification = document.createElement('div');
    notification.style.cssText = `
      background: ${color.bg};
      color: ${color.text};
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: auto;
      max-width: 320px;
      line-height: 1.4;
    `;

    notification.innerHTML = `
      <span style="font-size: 14px;">${color.icon}</span>
      <span>${message}</span>
    `;

    container.appendChild(notification);

    // Animate in
    requestAnimationFrame(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateX(0)';
    });

    // Auto dismiss after 3 seconds
    const dismissTimer = setTimeout(() => {
      dismissNotification(notification);
    }, 3000);

    // Dismiss on click
    notification.addEventListener('click', () => {
      clearTimeout(dismissTimer);
      dismissNotification(notification);
    });
  }

  function dismissNotification(notification) {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }

  // Listen for notification messages from background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'showNotification') {
      showNotification(request.message, request.type || 'info');
      sendResponse({ success: true });
    }
    if (request.action === 'getAdBlockStats') {
      sendResponse({ adsBlocked: adsBlocked });
    }
  });

  // Run initial ad hiding when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (adBlockEnabled) {
        hideAdElements();
      }
    });
  }
})();
