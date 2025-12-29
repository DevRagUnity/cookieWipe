# CookieWipe - Cookie Monitor & Cleanup

CookieWipe is a Chrome extension that allows you to monitor cookies in real-time and automatically clean them based on custom whitelist and blacklist rules.

## Features

* 
**Real-time Monitoring**: Watch cookies being added, changed, or removed as it happens.


* 
**Cookie Count Badge**: The extension icon displays the number of cookies for the current site.


* 
**Color-Coded Status**: The badge color changes based on domain status: Green (Whitelisted), Red (Blacklisted), or Blue (Neutral).


* 
**Automatic Cleanup**: Automatically deletes cookies when tabs are closed based on your rules.


* 
**Immediate Blocking**: "Immediate Mode" blocks blacklisted cookies as soon as they are set.


* 
**Retain Preferences**: Option to keep site settings like dark mode or language while deleting tracking cookies.


* 
**Wildcard Support**: Manage entire subdomains using patterns like `*.example.com`.



---

## How to Install

1. Open Google Chrome and navigate to `chrome://extensions/`.


2. Toggle on **Developer mode** in the top right corner.


3. Click the **Load unpacked** button.


4. Select the `cookiez` directory from your file browser.


5. The extension will now appear in your toolbar.



---

## Usage

### Cleanup Modes

* 
**Immediate Mode**: Best for privacy; it blocks cookies instantly so they never persist.


* 
**On Tab Close Mode**: Useful if a site requires cookies to function while browsing, but you want them deleted once you leave.



### Managing Domains

* 
**Whitelist**: Add domains here to ensure their cookies are always kept.


* 
**Blacklist**: Add domains here to ensure their cookies are deleted.


* 
**Manual Wipe**: Click **Delete Cookies Now** in the popup to instantly clear cookies for the current site.



Would you like me to create the `manifest.json` or `background.js` code for this project?