import * as mkc from "./mkc"

import { host } from "./host";

import { DOMParser, Element, XMLSerializer } from "@xmldom/xmldom";

export interface HttpRequestOptions {
    url: string
    method?: string // default to GET
    data?: any
    headers?: pxt.Map<string>
    allowHttpErrors?: boolean // don't treat non-200 responses as errors
    allowGzipPost?: boolean
}

export interface HttpResponse {
    statusCode: number
    headers: pxt.Map<string | string[]>
    buffer?: any
    text?: string
    json?: any
}

export function requestAsync(
    options: HttpRequestOptions
): Promise<HttpResponse> {
    log("Download " + options.url)
    return host().requestAsync(options).then<HttpResponse>(resp => {
        if (
            resp.statusCode != 200 &&
            resp.statusCode != 304 &&
            !options.allowHttpErrors
        ) {
            let msg = `Bad HTTP status code: ${resp.statusCode} at ${
                options.url
            }; message: ${(resp.text || "").slice(0, 500)}`
            let err: any = new Error(msg)
            err.statusCode = resp.statusCode
            return Promise.reject(err)
        }
        if (
            resp.text &&
            /application\/json/.test(resp.headers["content-type"] as string)
        )
            resp.json = JSON.parse(resp.text)
        return resp
    })
}

export function httpGetTextAsync(url: string) {
    return requestAsync({ url: url }).then(resp => resp.text)
}

export function httpGetJsonAsync(url: string) {
    return requestAsync({ url: url }).then(resp => resp.json)
}

export interface WebConfig {
    relprefix: string // "/beta---",
    workerjs: string // "/beta---worker",
    monacoworkerjs: string // "/beta---monacoworker",
    gifworkerjs: string // /beta---gifworker",
    pxtVersion: string // "?",
    pxtRelId: string // "9e298e8784f1a1d6787428ec491baf1f7a53e8fa",
    pxtCdnUrl: string // "https://cdn.makecode.com/commit/9e2...e8fa/",
    commitCdnUrl: string // "https://cdn.makecode.com/commit/9e2...e8fa/",
    blobCdnUrl: string // "https://cdn.makecode.com/commit/9e2...e8fa/",
    cdnUrl: string // "https://cdn.makecode.com"
    targetUrl: string // "https://pxt.microbit.org"
    targetVersion: string // "?",
    targetRelId: string // "9e298e8784f1a1d6787428ec491baf1f7a53e8fa",
    targetId: string // "microbit",
    simUrl: string // "https://trg-microbit.userpxt.io/beta---simulator"
    partsUrl?: string // /beta---parts
    runUrl?: string // "/beta---run"
    docsUrl?: string // "/beta---docs"
    isStatic?: boolean
    verprefix?: string // "v1"

    // added here
    rootUrl: string
    manifestUrl?: string
    files: { [index: string]: string }
}

function resolveUrl(root: string, path: string) {
    if (path[0] == "/") {
        return root.replace(/(:\/\/[^\/]*)\/.*/, (x, y) => y) + path
    }
    return path
}

async function parseWebConfigAsync(url: string): Promise<WebConfig | null> {
    // html
    const html: string = await httpGetTextAsync(url)

    const lines = html.split("\n");

    let rawConfig = "";
    let openBrackets = 0;
    for (const line of lines) {
        if (line.indexOf("var pxtConfig =") !== -1) {
            openBrackets++;
            rawConfig += line.slice(line.indexOf("{"));
        }
        else if (openBrackets) {
            if (line.indexOf("{") !== -1) {
                openBrackets++;
            }
            if (line.indexOf("}") !== -1) {
                openBrackets--;

                if (openBrackets === 0) {
                    rawConfig += line.slice(0, line.indexOf("}") + 1);
                    break;
                }
            }
            rawConfig += line;
        }
    }
    const config = rawConfig && (JSON.parse(rawConfig) as WebConfig)
    if (config) {
        config.rootUrl = url
        config.files = {}

        const m = /manifest="([^"]+)"/.exec(html)
        if (m) config.manifestUrl = resolveUrl(url, m[1])
    }
    return config
}

export interface DownloadInfo {
    manifestUrl?: string
    manifest?: string
    manifestEtag?: string
    cdnUrl?: string
    simKey?: string
    assetEditorKey?: string;
    versionNumber?: number
    updateCheckedAt?: number
    webConfig?: WebConfig
    targetVersion?: string
    targetConfig?: any //  see pxt/localtypings/pxtarget.d.ts interface TargetConfig

    cachedAssetEditorKey?: string;
    cachedSimulatorKey?: string;
}

function log(msg: string) {
    console.log(msg)
}

export async function downloadAsync(
    cache: mkc.Cache,
    webAppUrl: string,
    forceCheckUpdates = false
) {
    const infoBuf = await cache.getAsync(webAppUrl + "-info")
    const info: DownloadInfo = infoBuf
        ? JSON.parse(host().bufferToString(infoBuf))
        : {}
    const fetchTargetConfig = async (cdnUrl: string, target: string, version: string) => {
        const currentDate = new Date();
        const year = currentDate.getUTCFullYear();
        const month = `${currentDate.getUTCMonth()}`.padStart(2, "0");
        const day = `${currentDate.getUTCDay()}`.padStart(2, "0");
        const cacheBustId = `${year}${month}${day}`;
        const resp = await requestAsync({
            url: `${cdnUrl}/api/config/${target}/targetconfig${version ? `/v${version}`: ""}?cdn=${cacheBustId}`
        });
        return JSON.parse(resp.text);
    }

    if (forceCheckUpdates && info.manifest && info.webConfig) {
        let needsUpdate = false
        if (
            !info.updateCheckedAt ||
            Date.now() - info.updateCheckedAt > 24 * 3600 * 1000
        ) {
            info.updateCheckedAt = Date.now()
            await saveInfoAsync() // save last check time *before* checking - in case user hits ctrl-c we don't want another build to hang again
            try {
                log("Checking for updates (only happens once daily)...")
                needsUpdate = await hasNewManifestAsync()
                if (!needsUpdate) {
                    // fetch new target config as that is 'live'
                    const targetConfig = await fetchTargetConfig(
                        info.webConfig.cdnUrl,
                        info.webConfig.targetId,
                        info.targetVersion
                    );
                    if (targetConfig) {
                        info.targetConfig = targetConfig;
                        await saveInfoAsync();
                    }
                }
            } catch (e) {
                log(
                    `Error checking for updates; will try again tomorrow (use -u flag to force); ${e.message}`
                )
            }
        }
        if (!needsUpdate) return loadFromCacheAsync()
    } else {
        if (!(await hasNewManifestAsync())) return loadFromCacheAsync();
    }

    log("Download new webapp")
    const cfg = await parseWebConfigAsync(webAppUrl)
    if (!cfg.manifestUrl) cfg.manifestUrl = webAppUrl // use index.html if no manifest
    if (info.manifestUrl != cfg.manifestUrl || !info.webConfig) {
        info.manifestUrl = cfg.manifestUrl
        info.manifestEtag = null
        info.cdnUrl = cfg.cdnUrl
        info.webConfig = cfg
        await hasNewManifestAsync()
    }
    info.versionNumber = (info.versionNumber || 0) + 1
    info.updateCheckedAt = Date.now()

    await saveFileAsync("pxtworker.js");
    const targetJsonBuf = await saveFileAsync("target.json");
    const targetJson = JSON.parse(
        host().bufferToString(targetJsonBuf)
    );
    info.targetVersion = targetJson?.versions?.target;

    const targetConfig = await fetchTargetConfig(
        cfg.cdnUrl,
        cfg.targetId,
        info.targetVersion
    );
    info.targetConfig = targetConfig;

    if (cache.rootPath) {
        info.simKey = webAppUrl + "-sim.html"
        await downloadPageAndDependenciesAsync(cfg.simUrl, info.simKey);

        info.assetEditorKey = webAppUrl + "-asseteditor.html";
        await downloadPageAndDependenciesAsync(webAppUrl + "---asseteditor", info.assetEditorKey);
    }

    delete info.cachedAssetEditorKey;
    delete info.cachedSimulatorKey;

    return loadFromCacheAsync()

    function saveInfoAsync() {
        return cache.setAsync(
            webAppUrl + "-info",
            host().stringToBuffer(JSON.stringify(info))
        )
    }

    async function loadFromCacheAsync() {
        await saveInfoAsync()
        const res: mkc.DownloadedEditor = {
            cache,
            versionNumber: info.versionNumber || 0,
            cdnUrl: info.cdnUrl,
            website: webAppUrl,
            simUrl: info.simKey
                ? cache.rootPath + "/" + cache.expandKey(info.simKey)
                : null,
            pxtWorkerJs: host().bufferToString(
                await cache.getAsync(webAppUrl + "-pxtworker.js")
            ),
            targetJson: JSON.parse(
                host().bufferToString(await cache.getAsync(webAppUrl + "-target.json"))
            ),
            webConfig: info.webConfig,
            targetConfig: info.targetConfig
        }
        return res
    }

    async function saveFileAsync(name: string) {
        const resp = await requestAsync({ url: cfg.pxtCdnUrl + name })
        await cache.setAsync(webAppUrl + "-" + name, resp.buffer)
        return resp.buffer;
    }

    async function hasNewManifestAsync() {
        if (!info.manifestUrl || !info.webConfig) return true

        const resp = await requestAsync({
            url: info.manifestUrl,
            headers: info.manifestEtag
                ? {
                      "if-none-match": info.manifestEtag,
                  }
                : {},
        })

        if (resp.statusCode == 304) {
            info.updateCheckedAt = Date.now()
            return false
        }

        info.manifestEtag = resp.headers["etag"] as string
        if (resp.text == info.manifest) {
            info.updateCheckedAt = Date.now()
            return false
        }

        info.manifest = resp.text
        return true
    }

    async function downloadPageAndDependenciesAsync(url: string, cacheKey: string) {
        let pageText = await httpGetTextAsync(url);

        const dom = new DOMParser().parseFromString(pageText, "text/html");

        const additionalUrls: string[] = []
        const urlKeyMap: pxt.Map<string> = {}

        for (const script of dom.getElementsByTagName("script")) {
            if (!script.hasAttribute("src")) continue;

            const url = script.getAttribute("src");
            if (!url.startsWith(info.cdnUrl) || !url.endsWith(".js")) continue;

            additionalUrls.push(url);
            urlKeyMap[url] = webAppUrl + "-" + url.replace(/.*\//, "");
            script.setAttribute("src", cache.expandKey(urlKeyMap[url]));
        }

        for (const link of dom.getElementsByTagName("link")) {
            if (!link.hasAttribute("href")) continue;

            const url = link.getAttribute("href");
            if (!url.startsWith(info.cdnUrl) || !url.endsWith(".css")) continue;

            additionalUrls.push(url);
            urlKeyMap[url] = webAppUrl + "-" + url.replace(/.*\//, "");
            link.setAttribute("href", cache.expandKey(urlKeyMap[url]));
        }

        pageText = new XMLSerializer().serializeToString(dom);
        pageText = pageText.replace(/ manifest=/, " x-manifest=")

        await cache.setAsync(cacheKey, host().stringToBuffer(pageText))
        for (let url of additionalUrls) {
            const resp = await requestAsync({ url })
            await cache.setAsync(urlKeyMap[url], resp.buffer)
        }
    }
}
