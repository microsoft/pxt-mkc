export interface Host {
    readFileAsync(path: string, encoding?: "utf8"): Promise<string>;
    writeFileAsync(path: string, content: any, encoding?: "base64" | "utf8"): Promise<void>;
    mkdirAsync(path: string): Promise<void>;
    existsAsync(path: string): Promise<boolean>;
    unlinkAsync(path: string): Promise<void>;
    symlinkAsync(target: string, path: string, type: "file"): Promise<void>;
    listFilesAsync(directory: string, filename: string): Promise<string[]>;
    requestAsync(options: HttpRequestOptions, validate?: (protocol: string, method: string) => void): Promise<HttpResponse>;
}

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

let host_: Host;

export function setHost(newHost: Host) {
    host_ = newHost;
}

export function host() {
    if (!host) throw new Error("setHost() not called!")
    return host_;
}