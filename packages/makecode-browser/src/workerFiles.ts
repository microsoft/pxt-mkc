export const workerJs = `
/// <reference path="../src/types.d.ts" />
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
let _scriptText;
let nextId = 0;
let pendingMessages = {};
function registerDriverCallbacks() {
    // Proxy these to the client
    pxt.setupSimpleCompile({
        cacheGet: (key) => __awaiter(this, void 0, void 0, function* () {
            const res = yield sendRequestAsync({
                kind: "worker-to-client",
                type: "cacheGet",
                key
            });
            return res.value;
        }),
        cacheSet: (key, value) => __awaiter(this, void 0, void 0, function* () {
            yield sendRequestAsync({
                kind: "worker-to-client",
                type: "cacheSet",
                key,
                value
            });
        }),
        pkgOverrideAsync: (id) => __awaiter(this, void 0, void 0, function* () {
            const res = yield sendRequestAsync({
                kind: "worker-to-client",
                type: "packageOverride",
                packageId: id
            });
            return res.files;
        })
    });
}
function setWebConfig(config) {
    pxt.setupWebConfig(config);
}
function getWebConfig() {
    return pxt.webConfig;
}
function getAppTarget() {
    return pxt.appTarget;
}
function supportsGhPackages() {
    return !!pxt.simpleInstallPackagesAsync;
}
function setHwVariant(variant) {
    pxt.setHwVariant(variant);
}
function getHardwareVariants() {
    return pxt.getHwVariants();
}
function getBundledPackageConfigs() {
    return Object.values(pxt.appTarget.bundledpkgs).map(pkg => JSON.parse(pkg['pxt.json']));
}
function getCompileOptionsAsync(opts) {
    return pxt.simpleGetCompileOptionsAsync(_scriptText, opts);
}
function installGhPackagesAsync(projectFiles) {
    return pxt.simpleInstallPackagesAsync(projectFiles);
}
function performOperation(op, data) {
    return pxtc.service.performOperation(op, data);
}
function setProjectText(text) {
    _scriptText = text;
}
function enableExperimentalHardware() {
    pxt.savedAppTheme().experimentalHw = true;
    pxt.reloadAppTargetVariant();
}
function enableDebug() {
    pxt.options.debug = true;
}
function setCompileSwitches(flags) {
    pxt.setCompileSwitches(flags);
    if (pxt.appTarget.compile.switches.asmdebug) {
        ts.pxtc.assembler.debug = true;
    }
}
function onMessageReceived(message) {
    if (message.kind) {
        onResponseReceived(message);
    }
    else {
        onRequestReceivedAsync(message);
    }
}
function onRequestReceivedAsync(request) {
    return __awaiter(this, void 0, void 0, function* () {
        switch (request.type) {
            case "registerDriverCallbacks":
                registerDriverCallbacks();
                sendResponse(Object.assign(Object.assign({}, request), { response: true }));
                break;
            case "setWebConfig":
                setWebConfig(request.webConfig);
                sendResponse(Object.assign(Object.assign({}, request), { response: true }));
                break;
            case "getWebConfig":
                sendResponse(Object.assign(Object.assign({}, request), { webConfig: getWebConfig(), response: true }));
                break;
            case "getAppTarget":
                sendResponse(Object.assign(Object.assign({}, request), { appTarget: getAppTarget(), response: true }));
                break;
            case "supportsGhPackages":
                sendResponse(Object.assign(Object.assign({}, request), { supported: supportsGhPackages(), response: true }));
                break;
            case "setHwVariant":
                setHwVariant(request.variant);
                sendResponse(Object.assign(Object.assign({}, request), { response: true }));
                break;
            case "getHardwareVariants":
                sendResponse(Object.assign(Object.assign({}, request), { configs: getHardwareVariants(), response: true }));
                break;
            case "getBundledPackageConfigs":
                sendResponse(Object.assign(Object.assign({}, request), { configs: getBundledPackageConfigs(), response: true }));
                break;
            case "getCompileOptionsAsync":
                sendResponse(Object.assign(Object.assign({}, request), { result: yield getCompileOptionsAsync(request.opts), response: true }));
                break;
            case "installGhPackagesAsync":
                sendResponse(Object.assign(Object.assign({}, request), { result: yield installGhPackagesAsync(request.files), response: true }));
                break;
            case "performOperation":
                sendResponse(Object.assign(Object.assign({}, request), { result: performOperation(request.op, request.data), response: true }));
                break;
            case "setProjectText":
                setProjectText(request.files);
                sendResponse(Object.assign(Object.assign({}, request), { response: true }));
                break;
            case "enableExperimentalHardware":
                enableExperimentalHardware();
                sendResponse(Object.assign(Object.assign({}, request), { response: true }));
                break;
            case "enableDebug":
                enableDebug();
                sendResponse(Object.assign(Object.assign({}, request), { response: true }));
                break;
            case "setCompileSwitches":
                setCompileSwitches(request.flags);
                sendResponse(Object.assign(Object.assign({}, request), { response: true }));
                break;
        }
    });
}
function sendResponse(response) {
    postMessage(response);
}
function sendRequestAsync(request) {
    request.id = nextId++;
    return new Promise(resolve => {
        pendingMessages[request.id] = resolve;
        postMessage(request);
    });
}
function onResponseReceived(message) {
    if (pendingMessages[message.id]) {
        pendingMessages[message.id](message);
        delete pendingMessages[message.id];
    }
    else {
        console.warn("Worker received message with no callback");
    }
}
window.addEventListener("message", ev => {
    onMessageReceived(ev.data);
});
`;
