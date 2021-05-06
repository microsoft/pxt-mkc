import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as zlib from "zlib";
import * as events from "events";

import * as mkc from "./mkc"

export interface HttpRequestOptions {
    url: string;
    method?: string; // default to GET
    data?: any;
    headers?: pxt.Map<string>;
    allowHttpErrors?: boolean; // don't treat non-200 responses as errors
    allowGzipPost?: boolean;
}

export interface HttpResponse {
    statusCode: number;
    headers: pxt.Map<string | string[]>;
    buffer?: any;
    text?: string;
    json?: any;
}

function clone<T>(v: T): T {
    if (!v)
        return v
    return JSON.parse(JSON.stringify(v))
}

export function readResAsync(g: events.EventEmitter) {
    return new Promise<Buffer>((resolve, reject) => {
        let bufs: Buffer[] = []
        g.on('data', (c: any) => {
            if (typeof c === "string")
                bufs.push(Buffer.from(c, "utf8"))
            else
                bufs.push(c)
        });

        g.on("error", (err: any) => reject(err))

        g.on('end', () => resolve(Buffer.concat(bufs)))
    })
}

export function nodeHttpRequestAsync(options: HttpRequestOptions, validate?: (u: http.RequestOptions) => void): Promise<HttpResponse> {
    let isHttps = false

    let u = <http.RequestOptions><any>url.parse(options.url)

    if (u.protocol == "https:") isHttps = true
    /* tslint:disable:no-http-string */
    else if (u.protocol == "http:") isHttps = false
    /* tslint:enable:no-http-string */
    else return Promise.reject("bad protocol: " + u.protocol)

    u.headers = clone(options.headers) || {}
    let data = options.data
    u.method = options.method || (data == null ? "GET" : "POST");

    if (validate)
        validate(u)

    let buf: Buffer = null;

    u.headers["accept-encoding"] = "gzip"
    u.headers["user-agent"] = "MakeCode-CLI"

    let gzipContent = false

    if (data != null) {
        if (Buffer.isBuffer(data)) {
            buf = data;
        } else if (typeof data == "object") {
            buf = Buffer.from(JSON.stringify(data), "utf8")
            u.headers["content-type"] = "application/json; charset=utf8"
            if (options.allowGzipPost) gzipContent = true
        } else if (typeof data == "string") {
            buf = Buffer.from(data, "utf8")
            if (options.allowGzipPost) gzipContent = true
        } else {
            throw new Error("bad data")
        }
    }

    if (gzipContent) {
        buf = zlib.gzipSync(buf)
        u.headers['content-encoding'] = "gzip"
    }

    if (buf)
        u.headers['content-length'] = buf.length

    return new Promise<HttpResponse>((resolve, reject) => {
        const handleResponse = (res: http.IncomingMessage) => {
            let g: events.EventEmitter = res;
            if (/gzip/.test(res.headers['content-encoding'])) {
                let tmp = zlib.createUnzip();
                res.pipe(tmp);
                g = tmp;
            }

            resolve(readResAsync(g).then(buf => {
                let text: string = null
                try {
                    text = buf.toString("utf8")
                } catch (e) {
                }
                let resp: HttpResponse = {
                    statusCode: res.statusCode,
                    headers: res.headers,
                    buffer: buf,
                    text: text
                }
                return resp;
            }))
        };

        const req = isHttps ? https.request(u, handleResponse) : http.request(u, handleResponse);
        req.on('error', (err: any) => reject(err))
        req.end(buf)
    })
}


export function requestAsync(options: HttpRequestOptions): Promise<HttpResponse> {
    log("Download " + options.url)
    return nodeHttpRequestAsync(options)
        .then<HttpResponse>(resp => {
            if ((resp.statusCode != 200 && resp.statusCode != 304) && !options.allowHttpErrors) {
                let msg = `Bad HTTP status code: ${resp.statusCode} at ${options.url}; message: ${(resp.text || "").slice(0, 500)}`
                let err: any = new Error(msg)
                err.statusCode = resp.statusCode
                return Promise.reject(err)
            }
            if (resp.text && /application\/json/.test(resp.headers["content-type"] as string))
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

interface WebConfig {
    relprefix: string; // "/beta---",
    workerjs: string;  // "/beta---worker",
    monacoworkerjs: string; // "/beta---monacoworker",
    gifworkerjs: string; // /beta---gifworker",
    pxtVersion: string; // "?",
    pxtRelId: string; // "9e298e8784f1a1d6787428ec491baf1f7a53e8fa",
    pxtCdnUrl: string; // "https://pxt.azureedge.net/commit/9e2...e8fa/",
    commitCdnUrl: string; // "https://pxt.azureedge.net/commit/9e2...e8fa/",
    blobCdnUrl: string; // "https://pxt.azureedge.net/commit/9e2...e8fa/",
    cdnUrl: string; // "https://pxt.azureedge.net"
    targetUrl: string; // "https://pxt.microbit.org"
    targetVersion: string; // "?",
    targetRelId: string; // "9e298e8784f1a1d6787428ec491baf1f7a53e8fa",
    targetId: string; // "microbit",
    simUrl: string; // "https://trg-microbit.userpxt.io/beta---simulator"
    partsUrl?: string; // /beta---parts
    runUrl?: string; // "/beta---run"
    docsUrl?: string; // "/beta---docs"
    isStatic?: boolean;
    verprefix?: string; // "v1"

    // added here
    rootUrl: string;
    manifestUrl?: string;
    files: { [index: string]: string };
}

function resolveUrl(root: string, path: string) {
    if (path[0] == "/") {
        return root.replace(/(:\/\/[^\/]*)\/.*/, (x, y) => y) + path
    }
    return path
}

async function parseWebConfigAsync(url: string): Promise<WebConfig | null> {
    // html
    const html: string = await httpGetTextAsync(url);
    const m = /var pxtConfig = (\{[^}]+\})/.exec(html);
    const cfg = m && JSON.parse(m[1]) as WebConfig;
    if (cfg) {
        cfg.rootUrl = url;
        cfg.files = {};

        const m = /manifest="([^"]+)"/.exec(html);
        if (m)
            cfg.manifestUrl = resolveUrl(url, m[1]);
    }
    return cfg;
}

export interface DownloadInfo {
    manifestUrl?: string;
    manifest?: string;
    manifestEtag?: string;
    cdnUrl?: string;
    simKey?: string;
    versionNumber?: number;
    updateCheckedAt?: number;
}

function log(msg: string) {
    console.log(msg)
}

export async function downloadAsync(cache: mkc.Cache, webAppUrl: string, useCached = false) {
    const infoBuf = await cache.getAsync(webAppUrl + "-info")
    const info: DownloadInfo = infoBuf ? JSON.parse(infoBuf.toString("utf8")) : {}

    if (useCached && info.manifest) {
        let needsUpdate = false
        if (!info.updateCheckedAt || Date.now() - info.updateCheckedAt > 24 * 3600 * 1000) {
            info.updateCheckedAt = Date.now()
            await saveInfoAsync() // save last check time *before* checking - in case user hits ctrl-c we don't want another build to hang again
            try {
                log("Checking for updates (only happens once daily)...")
                needsUpdate = await hasNewManifestAsync()
            } catch (e) {
                log(`Error checking for updates; will try again tomorrow (use -u flag to force); ${e.message}`)
            }
        }
        if (!needsUpdate)
            return loadFromCacheAsync()
    } else {
        if (!await hasNewManifestAsync())
            return loadFromCacheAsync()
    }

    log("Download new webapp")
    const cfg = await parseWebConfigAsync(webAppUrl)
    if (!cfg.manifestUrl)
        cfg.manifestUrl = webAppUrl // use index.html if no manifest
    if (info.manifestUrl != cfg.manifestUrl) {
        info.manifestUrl = cfg.manifestUrl
        info.manifestEtag = null
        info.cdnUrl = cfg.cdnUrl
        await hasNewManifestAsync()
    }
    info.versionNumber = (info.versionNumber || 0) + 1
    info.updateCheckedAt = Date.now()

    for (let fn of ["pxtworker.js", "target.json"]) {
        await saveFileAsync(fn)
    }

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

        await cache.setAsync(info.simKey, Buffer.from(simTxt, "utf8"))
        for (let url of simurls) {
            const resp = await requestAsync({ url })
            await cache.setAsync(simkey[url], resp.buffer)
        }
    }

    return loadFromCacheAsync()

    function saveInfoAsync() {
        return cache.setAsync(webAppUrl + "-info", Buffer.from(JSON.stringify(info), "utf8"))
    }

    async function loadFromCacheAsync() {
        await saveInfoAsync()
        const res: mkc.DownloadedEditor = {
            cache,
            versionNumber: info.versionNumber || 0,
            cdnUrl: info.cdnUrl,
            website: webAppUrl,
            simUrl: info.simKey ? cache.rootPath + "/" + cache.expandKey(info.simKey) : null,
            pxtWorkerJs: (await cache.getAsync(webAppUrl + "-pxtworker.js")).toString("utf8"),
            targetJson: JSON.parse((await cache.getAsync(webAppUrl + "-target.json")).toString("utf8")),
        }
        return res
    }

    async function saveFileAsync(name: string) {
        const resp = await requestAsync({ url: cfg.pxtCdnUrl + name })
        await cache.setAsync(webAppUrl + "-" + name, resp.buffer)
    }

    async function hasNewManifestAsync() {
        if (!info.manifestUrl)
            return true

        const resp = await requestAsync({
            url: info.manifestUrl,
            headers: info.manifestEtag ? {
                "if-none-match": info.manifestEtag
            } : {},
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