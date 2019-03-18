import atob from "atob";
import btoa from "btoa";

let localStorageItems = new Map;
let spentUrl = new Map;
let spendId = new Map;
let spentTab = new Map;
let spentHosts = new Map;

window.localStorageItems = localStorageItems;
window.spentUrl = spentUrl;
window.spendId = spendId;
window.spentTab = spentTab;
window.spentHosts = spentHosts;

window.workflowSet = (workflow) => {
    workflow.__set__("localStorage", localStorageMock);
    workflow.__set__("localStorageItems", localStorageItems);
    workflow.__set__("updateIcon", updateIconMock);
    workflow.__set__("atob", atob);
    workflow.__set__("btoa", btoa);
    setXHR(mockXHRCommitments, workflow);

    workflow.__set__("get", get);
    workflow.__set__("set", set);

    workflow.__set__("setSpendFlag", setSpendFlag);
    workflow.__set__("getSpendFlag", getSpendFlag);

    workflow.__set__("spentUrl", spentUrl);
    workflow.__set__("setSpentUrl", setSpentUrl);
    workflow.__set__("getSpentUrl", getSpentUrl);

    workflow.__set__("spendId", spendId);
    workflow.__set__("setSpendId", setSpendId);
    workflow.__set__("getSpendId", getSpendId);

    workflow.__set__("spentTab", spentTab);
    workflow.__set__("setSpentTab", setSpentTab);
    workflow.__set__("getSpentTab", getSpentTab);


    workflow.__set__("spentHosts", spentHosts);
    workflow.__set__("setSpentHosts", setSpentHosts);
    workflow.__set__("getSpentHosts", getSpentHosts);

}

window.localStorageMock = {
    getItem: key => JSON.parse(localStorageItems[key]),
    setItem: (key, value) => localStorageItems[key] = JSON.stringify(value),
    clear: () => localStorageItems = {},
    removeItem: (key) => localStorageItems[key] = undefined,
};

window.updateIconMock = jest.fn();

window.setSpendFlag = (key, value) => set(key, value);
window.getSpendFlag = (key) => get(key)

window.get = (key) => JSON.parse(localStorage.getItem(key));
window.set = (key, value) => localStorage.setItem(key, JSON.stringify(value));

window.bypassTokens = (config_id) => `bypass-tokens-${config_id}`;
window.bypassTokensCount = (config_id) => `bypass-tokens-count-${config_id}`;

/* mock XHR implementations */
function mockXHR(_xhr) {
    _xhr.open = function (method, url) {
        _xhr.method = method;
        _xhr.url = url;
    };
    _xhr.requestHeaders = new Map();
    _xhr.getRequestHeader = function (name) {
        return _xhr.requestHeaders[name];
    }
    _xhr.setRequestHeader = function (name, value) {
        _xhr.requestHeaders[name] = value;
    }
    _xhr.overrideMimeType = jest.fn();
    _xhr.body;
    _xhr.send = function (str) {
        _xhr.body = str;
    }
    _xhr.onreadystatechange = function () {
    };
}

/* mock XHR implementations */
window.mockXHR = (_xhr) => {
    _xhr.open = function (method, url) {
        _xhr.method = method;
        _xhr.url = url;
    };
    _xhr.requestHeaders = new Map();
    _xhr.getRequestHeader = function (name) {
        return _xhr.requestHeaders[name];
    }
    _xhr.setRequestHeader = function (name, value) {
        _xhr.requestHeaders[name] = value;
    }
    _xhr.overrideMimeType = jest.fn();
    _xhr.body;
    _xhr.send = function (str) {
        _xhr.body = str;
    }
    _xhr.onreadystatechange = function () {
    };
}

window.mockXHRCommitments = () => mockXHR(this);

window.getSpentUrl = (key) => spentUrl[key];
window.setSpentUrl = (key, value) => spentUrl[key] = value;

window.getSpendId = (key) => spendId[key];
window.setSpendId = (key, value) => spendId[key] = value;

window.getSpentTab = (key) => spentTab[key];
window.setSpentTab = (key, value) => spentTab[key] = value;
window.clearSpentTab = () => spentTab = new Map();

window.getSpentHosts = (key) => spentHosts[key];
window.setSpentHosts = (key, value) => spentHosts[key] = value;

window.setXHR = (xhr, workflow) => workflow.__set__("XMLHttpRequest", xhr);

// function getSpendId(key) {
//     let spendId = workflow.__get__("spendId");
//     return spendId[key];
// }
//
// function getSpentTab(key) {
//     let spentTab = workflow.__get__("spentTab");
//     return spentTab[key];
// }
//
// function setSpentHosts(key, value) {
//     let spentHosts = new Map();
//     spentHosts[key] = value;
//     workflow.__set__("spentHosts", spentHosts);
// }
//

//
//
