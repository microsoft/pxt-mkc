import { WebConfig } from "./downloader";
import { DownloadedEditor, Package } from "./mkc";
import { BuiltSimJsInfo, CompileOptions, CompileResult } from "./service";

export interface Host {
    readFileAsync(path: string, encoding: "utf8"): Promise<string>;
    readFileAsync(path: string, encoding?: "utf8"): Promise<string | Uint8Array>;

    writeFileAsync(path: string, content: any, encoding?: "base64" | "utf8"): Promise<void>;
    mkdirAsync(path: string): Promise<void>;
    rmdirAsync(path: string, options: any): Promise<void>;
    existsAsync(path: string): Promise<boolean>;
    unlinkAsync(path: string): Promise<void>;
    symlinkAsync(target: string, path: string, type: "file"): Promise<void>;
    listFilesAsync(directory: string, filename: string): Promise<string[]>;
    requestAsync(options: HttpRequestOptions, validate?: (protocol: string, method: string) => void): Promise<HttpResponse>;
    createLanguageServiceAsync(editor: DownloadedEditor): Promise<LanguageService>;
    getDeployDrivesAsync(compile: any): Promise<string[]>;
    exitWithStatus(code: number): never;
    getEnvironmentVariable(key: string): string | undefined;
    cwdAsync(): Promise<string>;

    bufferToString(buffer: Uint8Array): string;
    stringToBuffer (str: string, encoding?: "utf8" | "base64"): Uint8Array;
    base64EncodeBufferAsync(buffer: Uint8Array): Promise<string>;

    guidGen?(): string;
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

export interface SimpleDriverCallbacks {
    cacheGet: (key: string) => Promise<string>
    cacheSet: (key: string, val: string) => Promise<void>
    httpRequestAsync?: (
        options: HttpRequestOptions
    ) => Promise<HttpResponse>
    pkgOverrideAsync?: (id: string) => Promise<pxt.Map<string>>
}

export interface LanguageService {
    registerDriverCallbacksAsync(callbacks: SimpleDriverCallbacks): Promise<void>
    setWebConfigAsync(config: WebConfig): Promise<void>;
    getWebConfigAsync(): Promise<WebConfig>;
    getAppTargetAsync(): Promise<any>;
    getTargetConfigAsync(): Promise<any>;
    supportsGhPackagesAsync(): Promise<boolean>;
    setHwVariantAsync(variant: string): Promise<void>;
    getHardwareVariantsAsync(): Promise<pxt.PackageConfig[]>;
    getBundledPackageConfigsAsync(): Promise<pxt.PackageConfig[]>;
    getCompileOptionsAsync(prj: Package, simpleOpts?: any): Promise<CompileOptions>;
    installGhPackagesAsync(projectFiles: pxt.Map<string>): Promise<pxt.Map<string>>;
    setProjectTextAsync(projectFiles: pxt.Map<string>): Promise<void>;
    performOperationAsync(op: string, options: any): Promise<any>;

    enableExperimentalHardwareAsync(): Promise<void>;
    enableDebugAsync(): Promise<void>;
    setCompileSwitchesAsync(flags: string): Promise<void>
    buildSimJsInfoAsync(result: CompileResult): Promise<BuiltSimJsInfo>

    dispose?: () => void;
}

let host_: Host;

export function setHost(newHost: Host) {
    host_ = newHost;
}

export function host() {
    if (!host) throw new Error("setHost() not called!")
    return host_;
}