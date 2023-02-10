import * as mkc from "./mkc"

import { host } from "./host";

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
    pxtCdnUrl: string // "https://pxt.azureedge.net/commit/9e2...e8fa/",
    commitCdnUrl: string // "https://pxt.azureedge.net/commit/9e2...e8fa/",
    blobCdnUrl: string // "https://pxt.azureedge.net/commit/9e2...e8fa/",
    cdnUrl: string // "https://pxt.azureedge.net"
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
    const m = /var pxtConfig = (\{[^}]+\})/.exec(html)
    const cfg = m && (JSON.parse(m[1]) as WebConfig)
    if (cfg) {
        cfg.rootUrl = url
        cfg.files = {}

        const m = /manifest="([^"]+)"/.exec(html)
        if (m) cfg.manifestUrl = resolveUrl(url, m[1])
    }
    return cfg
}

export interface DownloadInfo {
    manifestUrl?: string
    manifest?: string
    manifestEtag?: string
    cdnUrl?: string
    simKey?: string
    versionNumber?: number
    updateCheckedAt?: number
    webConfig?: WebConfig
    targetVersion?: string
    targetConfig?: any //  see pxt/localtypings/pxtarget.d.ts interface TargetConfig
}

function log(msg: string) {
    console.log(msg)
}

export async function downloadAsync(
    cache: mkc.Cache,
    webAppUrl: string,
    useCached = false
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
        return await requestAsync({
            url: `${cdnUrl}/api/config/${target}/targetconfig${version ? `/v${version}`: ""}?cdn=${cacheBustId}`
        }).then(trgCfg => {
            return JSON.parse(trgCfg.text);
        });
    }

    if (useCached && info.manifest && info.webConfig) {
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
    } else if (useCached) {
        if (!(await hasNewManifestAsync())) return loadFromCacheAsync()
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

    await saveFileAsync("pxtworker.js")
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
        let simTxt = await httpGetTextAsync(cfg.simUrl)
        const simurls: string[] = []
        const simkey: pxt.Map<string> = {}
        simTxt = simTxt.replace(/https:\/\/[\w\/\.\-]+/g, f => {
            if (f.startsWith(info.cdnUrl)) {
                simurls.push(f)
                const base = f.replace(/.*\//, "")
                simkey[f] = webAppUrl + "-" + base
                return cache.expandKey(simkey[f])
            }
            return f
        })
        simTxt = simTxt.replace(/ manifest=/, " x-manifest=")

        info.simKey = webAppUrl + "-sim.html"

        await cache.setAsync(info.simKey, host().stringToBuffer(simTxt))
        for (let url of simurls) {
            const resp = await requestAsync({ url })
            await cache.setAsync(simkey[url], resp.buffer)
        }
    }

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
}
