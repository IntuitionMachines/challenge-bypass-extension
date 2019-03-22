/**
 * This background page handles the sending requests and dealing with responses.
 * Passes are exchanged with the server containing blinded tokens for bypassing CAPTCHAs.
 * Control flow is handled in the listeners. Cryptography uses SJCL.
 *
 * @author: George Tankersley
 * @author: Alex Davidson
 */

/* exported handleCompletion */
/* exported handleMessage */
/* exported processRedirect */
/* exported processHeaders */
/* exported beforeSendHeaders */
/* exported beforeRequest */
/* exported resetSpendVars */
/* exported committedNavigation */
/* exported cookiesChanged */
/* exported chlCaptchaDomain */
/* exported chlClearanceCookie */
/* exported redeemMethod */
/* exported reloadOnSign */
/* exported spentTab, timeSinceLastResp, futureReload, sentTokens */
/* exported dev */
/* exported commitmentsKey */
/* exported storageKeyTokens, storageKeyCount */
/* exported sendH2CParams, maxTokens, signResponseFMT, tokensPerRequest */
/* exported CONFIG_ID */
/* exported issueActionUrls */
/* exported LISTENER_URLS */
/* exported CONFIG_STORAGE_KEY */
"use strict";

const LISTENER_URLS = "<all_urls>";
let CONFIG_ID = 1;
const STORAGE_STR = "bypass-tokens-";
const COUNT_STR = STORAGE_STR + "count-";
const activeConfig = () => PPConfigs()[CONFIG_ID];
const dev = () => activeConfig()["dev"];
const chlClearanceCookie = () => activeConfig()["cookies"]["clearance-cookie"];
const chlCaptchaDomain = () => activeConfig()["captcha-domain"]; // cookies have dots prepended
const chlVerificationError = () => activeConfig()["error-codes"]["connection-error"];
const chlConnectionError = () => activeConfig()["error-codes"]["verify-error"];
const commitmentsKey = () => activeConfig()["commitments"];
const spendMax = () => activeConfig()["max-spends"];
const maxTokens = () => activeConfig()["max-tokens"];
const doSign = () => activeConfig()["sign"];
const doRedeem = () => activeConfig()["redeem"];
const redeemMethod = () => activeConfig()["spend-action"]["redeem-method"];
const headerName = () => activeConfig()["spend-action"]["header-name"];
const headerHostName = () => activeConfig()["spend-action"]["header-host-name"];
const headerPathName = () => activeConfig()["spend-action"]["header-path-name"];
const spendActionUrls = () => activeConfig()["spend-action"]["urls"];
const spendStatusCode = () => activeConfig()["spending-restrictions"]["status-code"];
const maxRedirect = () => activeConfig()["spending-restrictions"]["max-redirects"];
const newTabs = () => activeConfig()["spending-restrictions"]["new-tabs"];
const badNav = () => activeConfig()["spending-restrictions"]["bad-navigation"];
const badTransition = () => activeConfig()["spending-restrictions"]["bad-transition"];
const validRedirects = () => activeConfig()["spending-restrictions"]["valid-redirects"];
const validTransitions = () => activeConfig()["spending-restrictions"]["valid-transitions"];
const varReset = () => activeConfig()["var-reset"];
const varResetMs = () => activeConfig()["var-reset-ms"];
const storageKeyTokens = () => STORAGE_STR + activeConfig()["id"];
const storageKeyCount = () => COUNT_STR + activeConfig()["id"];
const h2cParams = () => activeConfig()["h2c-params"];
const sendH2CParams = () => activeConfig()["send-h2c-params"];
const issueActionUrls = () => activeConfig()["issue-action"]["urls"]
const reloadOnSign = () => activeConfig()["issue-action"]["sign-reload"];
const signResponseFMT = () => activeConfig()["issue-action"]["sign-resp-format"];
const tokensPerRequest = () => activeConfig()["issue-action"]["tokens-per-request"];


/* Config variables that are reset in setConfig() depending on the header value that is received (see config.js) */
initECSettings(h2cParams());

// Used for resetting variables below
let timeSinceLastResp = 0;

// Prevent too many redirections from exhausting tokens
let redirectCount = new Map();

// Set if a spend has occurred for a req id
let spendId = new Map();

// used for checking if we've already spent a token for this host to
// prevent token DoS attacks
let spentHosts = new Map();

// Used for tracking spends globally
let spentUrl = new Map();

// We want to monitor attempted spends to check if we should remove cookies
let httpsRedirect = new Map();

// Monitor whether we have already sent tokens for signing
let sentTokens = new Map();

// URL string for determining where tokens should be spent
let target = new Map();

// Used for firefox primarily
let futureReload = new Map();

// Tabs that a spend occurred in
let spentTab = new Map();

// Track whether we should try to initiate a signing request
let readySign = false;

/**
 * Functions used by event listeners (listeners.js)
 */

/**
 * Runs when a request is completed
 * @param details HTTP request details
 */
function handleCompletion(details) {
    timeSinceLastResp = Date.now();
    // If we had a spend and we're using "reload" method then reload the page
    if (getSpendId(details.requestId) && redeemMethod() === "reload") {
        reloadBrowserTab(details.tabId);
    }
    setSpendId(details.requestId, false)
}

/**
 * If a redirect occurs then we want to see if we had spent previously
 * If so then it is likely that we will want to spend on the redirect
 * @param details contains the HTTP redirect info
 * @param oldUrl URL object of previous navigation
 * @param newUrl URL object of current redirection
 */
function processRedirect(details, oldUrl, newUrl) {
    httpsRedirect[newUrl.href] = validRedirect(oldUrl.href, newUrl.href);
    if (redirectCount[details.requestId] === undefined) {
        redirectCount[details.requestId] = 0;
    }
    if (getSpendId(details.requestId) && redirectCount[details.requestId] < maxRedirect()) {
        setSpendFlag(newUrl.host, true);
        setSpendId(details.requestId, false);
        redirectCount[details.requestId] = redirectCount[details.requestId] + 1;
    }
}

function validRedirect(oldUrl, redirectUrl) {
    if (oldUrl.includes("http://")) {
        let urlStr = oldUrl.substring(7);
        let valids = validRedirects();
        for (let i = 0; i < valids.length; i++) {
            let newUrl = valids[i] + urlStr;
            if (newUrl === redirectUrl) {
                return true;
            }
        }
    }
    return false;
}

const getSpentUrl = (key) => spentUrl[key];
const setSpentUrl = (key, value) => spentUrl[key] = value;

const getSpendId = (key) => spendId[key];
const setSpendId = (key, value) => spendId[key] = value;

const getSpentTab = (key) => spentTab[key];
const setSpentTab = (key, value) => spentTab[key] = value;

const getSpentHosts = (key) => spentHosts[key];
const setSpentHosts = (key, value) => spentHosts[key] = value;


/**
 * Headers are received before document render. The blocking attributes allows
 * us to cancel requests instead of loading an unnecessary ReCaptcha widget.
 * @param details contains the HTTP response info
 * @param url request URL object
 */
function processHeaders(details, url) {
    // We're not interested in running this logic for favicons
    if (isFaviconUrl(url.href)) {
        return false;
    }

    let activated = false;
    for (var i = 0; i < details.responseHeaders.length; i++) {
        const header = details.responseHeaders[i];
        if (header.name.toLowerCase() === CHL_BYPASS_RESPONSE) {
            if (header.value === chlVerificationError()
                || header.value === chlConnectionError()) {
                // If these errors occur then something bad is happening.
                // Either tokens are bad or some resource is calling the server
                // in a bad way
                if (header.value === chlVerificationError()) {
                    clearStorage();
                }
                throw new Error("[privacy-pass]: There may be a problem with the stored tokens. Redemption failed for: " + url.href + " with error code: " + header.value);
            }
        }

        // correct status code with the right header indicates a bypassable Cloudflare CAPTCHA
        if (isBypassHeader(header) && spendStatusCode().includes(details.statusCode)) {
            activated = true;
        }
    }

    // If we have tokens to spend, cancel the request and pass execution over to the token handler.
    let attempted = false;
    if (activated && !getSpentUrl(url.href)) {
        let count = countStoredTokens();
        if (doRedeem()) {
            if (count > 0 && !url.host.includes(chlCaptchaDomain())) {
                attemptRedeem(url, details.tabId, target);
                attempted = true;
            } else if (count === 0) {
                // Update icon to show user that token may be spent here
                updateIcon("!");
            }
        }

        // If signing is permitted then we should note this
        if (!attempted && doSign()) {
            readySign = true;
        }
    }
    return attempted;
}

/**
 * If a spend flag is set then we alter the request and add a header
 * containing a valid BlindTokenRequest for redemption
 * @param request HTTP request details
 * @param url URL object of request
 */
function beforeSendHeaders(request, url) {
    // Cancel if we don't have a token to spend

    let reqUrl = url.href;
    let host = url.host;

    if (doRedeem() && !isErrorPage(reqUrl) && !isFaviconUrl(reqUrl) && !checkMaxSpend(host) && getSpendFlag(host)) {
        // No reload method branch
        if (redeemMethod() === "no-reload") {
            // check that we're at an URL that can handle redeems
            const isRedeemUrl = spendActionUrls()
                .map(redeemUrl => patternToRegExp(redeemUrl))
                .some(re => reqUrl.match(re));

            setSpendFlag(url.host, null);

            if (countStoredTokens() > 0 && isRedeemUrl) {

                const tokenToSpend = GetTokenForSpend();
                if (tokenToSpend == null) {
                    return {cancel: false};
                }
                setSpendFlag(host, null);
                incrementSpentHost(host);

                const http_path = request.method + " " + url.pathname;
                const redemptionString = BuildRedeemHeader(tokenToSpend, url.hostname, http_path);
                let headers = request.requestHeaders
                headers.push({name: headerName(), value: redemptionString});
                headers.push({name: headerHostName(), value: url.hostname});
                headers.push({name: headerPathName(), value: http_path});
                setSpendId(request.requestId, true);
                setSpentUrl(reqUrl, true);
                return {requestHeaders: headers};
            }
        } else if (redeemMethod() === "reload" && !getSpentUrl(reqUrl)) {
            return getReloadHeaders(request, url);
        }
    }

    return {cancel: false}
}

// returns the new headers for the request
function getReloadHeaders(request, url) {
    let headers = request.requestHeaders;
    setSpendFlag(url.host, null);
    incrementSpentHost(url.host);
    target[request.tabId] = "";

    // Create a pass and reload to send it to the edge
    const tokenToSpend = GetTokenForSpend();
    if (tokenToSpend == null) {
        return {cancel: false};
    }

    const method = request.method;
    const http_path = method + " " + url.pathname;
    const redemptionString = BuildRedeemHeader(tokenToSpend, url.hostname, http_path);
    const newHeader = {name: headerName(), value: redemptionString};
    headers.push(newHeader);
    setSpendId(request.requestId, true);
    setSpentUrl(url.href, true);
    if (!getSpentTab(request.tabId)) {
        setSpentTab(request.tabId, []);
    }
    let spentTabs = getSpentTab(request.tabId);
    spentTabs.push(url.href)
    setSpentTab(request.tabId, spentTabs);
    return {requestHeaders: headers};
}

/**
 * This function filters requests before we've made a connection. If we don't
 * have tokens, it asks for new ones when we solve a captcha.
 * @param details HTTP request details
 * @param url URL object of request
 */
function beforeRequest(details, url) {
    // Clear vars if they haven't been used for a while
    if (varReset() && Date.now() - varResetMs() > timeSinceLastResp) {
        resetVars();
    }

    // Only sign tokens if config says so and the appropriate header was received previously
    if (!doSign() || !readySign) {
        return false;
    }

    // Different signing methods based on configs
    let xhrInfo;
    switch (CONFIG_ID) {
    case 1:
        xhrInfo = signReqCF(url);
        break;
    case 2:
        xhrInfo = signReqHC(url);
        break;
    default:
        throw new Error("Incorrect config ID specified");
    }

    // If this is null then signing is not appropriate
    if (xhrInfo === null) {
        return false;
    }
    readySign = false;

    // actually send the token signing request via xhr and return the xhr object
    let xhr = sendXhrSignReq(xhrInfo, url, details.tabId);
    return {xhr: xhr};
}

// Set the target URL for the spend and update the tab if necessary
/**
 * When navigation is committed we may want to reload.
 * @param details Navigation details
 * @param url url of navigation
 */
function committedNavigation(details, url) {
    let redirect = details.transitionQualifiers[0];
    let tabId = details.tabId;
    if (!badNav().includes(details.transitionType)
        && (!badTransition(url.href, redirect, details.transitionType))
        && !isNewTab(url.href)) {
        let id = getTabId(tabId);
        target[id] = url.href;
        // If a reload was attempted but target hadn't been inited then reload now
        if (futureReload[id] === target[id]) {
            futureReload[id] = false;
            updateBrowserTab(id, target[id]);
        }
    }
}

// Handle messages from popup
function handleMessage(request, sender, sendResponse) {
    if (request.callback) {
        UpdateCallback = request.callback;
    } else if (request.tokLen) {
        sendResponse(countStoredTokens());
    } else if (request.clear) {
        clearStorage();
    }
}

/* Token storage functions */
function incrementSpentHost(host) {
    if (getSpentHosts(host) === undefined) {
        setSpentHosts(host, 0);
    }
    setSpentHosts(host, getSpentHosts(host) + 1)
}

function checkMaxSpend(host) {
    if (getSpentHosts(host) === undefined || getSpentHosts(host) < spendMax() || spendMax() === 0) {
        return false;
    }
    return true
}

// Pops a token from storage for a redemption
function GetTokenForSpend() {
    let tokens = loadTokens();
    // prevent null checks
    if (tokens == null) {
        return null;
    }
    const tokenToSpend = tokens[0];
    tokens = tokens.slice(1);
    storeTokens(tokens);
    return tokenToSpend;
}


// Clears the stored tokens and other variables
function clearStorage() {
    clear();
    resetVars();
    resetSpendVars();
    // Update icons
    updateIcon(0);
    UpdateCallback();
}

/* Utility functions */

// Checks whether a transition is deemed to be bad to prevent loading subresources
// in address bar
function checkBadTransition(href, type, transitionType) {
    if (httpsRedirect[href]) {
        httpsRedirect[href] = false;
        return false;
    }
    let maybeGood = (validTransitions().includes(transitionType));
    if (!type && !maybeGood) {
        return true;
    }
    return badTransition().includes(type);
}

// Checks if the tab is deemed to be new or not
function isNewTab(url) {
    for (let i = 0; i < newTabs().length; i++) {
        if (url.includes(newTabs()[i])) {
            return true;
        }
    }
    return false;
}

// Reset variables
function resetVars() {
    redirectCount = new Map();
    sentTokens = new Map();
    target = new Map();
    spendId = new Map();
    futureReload = new Map();
    spentHosts = new Map();
}

// Reset variables that are used for restricting spending
function resetSpendVars() {
    spentTab = new Map();
    spentUrl = new Map();
}

/**
 * Checks whether a header should activate the extension. The value dictates
 * whether to swap to a new configuration
 * @param {header} header
 */
function isBypassHeader(header) {
    let newConfigVal = parseInt(header.value);
    if (header.name.toLowerCase() === CHL_BYPASS_SUPPORT && newConfigVal !== 0) {
        if (newConfigVal !== CONFIG_ID) {
            setConfig(newConfigVal);
        }
        return true
    }
    return false;
}

/**
 * CHanges the active configuration when the client receives a new configuration
 * value.
 * @param {int} val
 */
function setConfig(val) {
    CONFIG_ID = val
    initECSettings(h2cParams());
    clearCachedCommitments();
    countStoredTokens();
}