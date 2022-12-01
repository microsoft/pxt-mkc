/// <reference path="../src/types.d.ts" />

let _scriptText: pxt.Map<string>;
let nextId = 0;
let pendingMessages: pxt.Map<(response: WorkerToClientRequestResponse) => void> = {};

function registerDriverCallbacks() {
    // Proxy these to the client
    pxt.setupSimpleCompile({
        cacheGet: async key => {
            const res = await sendRequestAsync({
                kind: "worker-to-client",
                type: "cacheGet",
                key
            }) as CacheGetResponse;

            return res.value;
        },
        cacheSet: async (key, value) => {
            await sendRequestAsync({
                kind: "worker-to-client",
                type: "cacheSet",
                key,
                value
            }) as CacheSetResponse;
        },
        pkgOverrideAsync: async id => {
            const res = await sendRequestAsync({
                kind: "worker-to-client",
                type: "packageOverride",
                packageId: id
            }) as PackageOverrideResponse;

            return res.files;
        }
    });
}

function setWebConfig(config: any) {
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

function setHwVariant(variant: string) {
    pxt.setHwVariant(variant);
}

function getHardwareVariants() {
    return pxt.getHwVariants();
}

function getBundledPackageConfigs() {
    return Object.values(pxt.appTarget.bundledpkgs).map(pkg => JSON.parse(pkg['pxt.json']));
}

function getCompileOptionsAsync(opts: pxt.SimpleCompileOptions) {
    return pxt.simpleGetCompileOptionsAsync(_scriptText, opts)
}

function installGhPackagesAsync(projectFiles: pxt.Map<string>) {
    return pxt.simpleInstallPackagesAsync(projectFiles);
}

function performOperation(op: string, data: any) {
    return pxtc.service.performOperation(op as any, data);
}

function setProjectText(text: pxt.Map<string>) {
    _scriptText = text;
}

function enableExperimentalHardware() {
    pxt.savedAppTheme().experimentalHw = true;
    pxt.reloadAppTargetVariant();
}

function enableDebug() {
    pxt.options.debug = true;
}

function setCompileSwitches(flags: string) {
    pxt.setCompileSwitches(flags);
    if ((pxt.appTarget.compile.switches as any).asmdebug) {
        ts.pxtc.assembler.debug = true
    }
}

function onMessageReceived(message: WorkerToClientRequestResponse | ClientToWorkerRequest) {
    if ((message as WorkerToClientRequestResponse).kind) {
        onResponseReceived(message as WorkerToClientRequestResponse);
    }
    else {
        onRequestReceivedAsync(message as ClientToWorkerRequest);
    }
}

async function onRequestReceivedAsync(request: ClientToWorkerRequest) {
    switch (request.type) {
        case "registerDriverCallbacks":
            registerDriverCallbacks();
            sendResponse({
                ...request,
                response: true
            });
            break;
        case "setWebConfig":
            setWebConfig(request.webConfig);
            sendResponse({
                ...request,
                response: true
            });
            break;
        case "getWebConfig":
            sendResponse({
                ...request,
                webConfig: getWebConfig(),
                response: true
            });
            break;
        case "getAppTarget":
            sendResponse({
                ...request,
                appTarget: getAppTarget(),
                response: true
            });
            break;
        case "supportsGhPackages":
            sendResponse({
                ...request,
                supported: supportsGhPackages(),
                response: true
            });
            break;
        case "setHwVariant":
            setHwVariant(request.variant);
            sendResponse({
                ...request,
                response: true
            })
            break;
        case "getHardwareVariants":
            sendResponse({
                ...request,
                configs: getHardwareVariants(),
                response: true
            });
            break;
        case "getBundledPackageConfigs":
            sendResponse({
                ...request,
                configs: getBundledPackageConfigs(),
                response: true
            });
            break;
        case "getCompileOptionsAsync":
            sendResponse({
                ...request,
                result: await getCompileOptionsAsync(request.opts),
                response: true
            });
            break;
        case "installGhPackagesAsync":
            await installGhPackagesAsync(request.files)
            sendResponse({
                ...request,
                result: request.files,
                response: true
            });
            break;
        case "performOperation":
            sendResponse({
                ...request,
                result: performOperation(request.op, request.data),
                response: true
            });
            break;
        case "setProjectText":
            setProjectText(request.files);
            sendResponse({
                ...request,
                response: true
            });
            break;
        case "enableExperimentalHardware":
            enableExperimentalHardware();
            sendResponse({
                ...request,
                response: true
            });
            break;
        case "enableDebug":
            enableDebug();
            sendResponse({
                ...request,
                response: true
            });
            break;
        case "setCompileSwitches":
            setCompileSwitches(request.flags);
            sendResponse({
                ...request,
                response: true
            });
            break;
    }
}

function sendResponse(response: ClientToWorkerRequestResponse) {
    postMessage(response);
}

function sendRequestAsync(request: WorkerToClientRequest): Promise<WorkerToClientRequestResponse> {
    request.id = nextId++;

    return new Promise(resolve => {
        pendingMessages[request.id!] = resolve;
        postMessage(request);
    });
}

function onResponseReceived(message: WorkerToClientRequestResponse) {
    if (pendingMessages[message.id!]) {
        pendingMessages[message.id!](message);
        delete pendingMessages[message.id!];
    }
    else {
        console.warn("Worker received message with no callback");
    }
}

addEventListener("message", ev => {
    onMessageReceived(ev.data);
});