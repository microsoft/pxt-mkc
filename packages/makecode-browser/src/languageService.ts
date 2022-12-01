import { WebConfig } from "makecode-core/built/downloader";
import { CompileOptions } from "makecode-core/built/service";
import { LanguageService, SimpleDriverCallbacks } from "makecode-core/built/host";
import { DownloadedEditor, Package } from "makecode-core";
import { workerJs } from "./workerFiles";

export class BrowserLanguageService implements LanguageService {
    protected nextID = 0;
    protected pendingMessages: { [index: string]: (response: ClientToWorkerRequestResponse) => void };
    protected worker: Worker;
    protected driverCallbacks: SimpleDriverCallbacks;

    constructor(public editor: DownloadedEditor) {
        this.pendingMessages = {};

        let workerSource = `var pxtTargetBundle = ${JSON.stringify(this.editor.targetJson)};\n`
        workerSource += this.editor.pxtWorkerJs + "\n";
        workerSource += workerJs;

        const workerBlob = new Blob([workerSource], { type: "application/javascript" });

        this.worker = new Worker(URL.createObjectURL(workerBlob));
        this.worker.onmessage = ev => {
            if (ev.data.kind) {
                this.onWorkerRequestReceived(ev.data);
            }
            else {
                this.onWorkerResponseReceived(ev.data);
            }
        }
    }

    async registerDriverCallbacksAsync(callbacks: SimpleDriverCallbacks): Promise<void> {
        this.driverCallbacks = callbacks;

        await this.sendWorkerRequestAsync({
            type: "registerDriverCallbacks"
        });
    }

    async setWebConfigAsync(config: WebConfig): Promise<void> {
        await this.sendWorkerRequestAsync({
            type: "setWebConfig",
            webConfig: config as any
        });
    }

    async getWebConfigAsync(): Promise<WebConfig> {
        const res = await this.sendWorkerRequestAsync({
            type: "getWebConfig"
        }) as GetWebConfigResponse;

        return res.webConfig as any;
    }

    async getAppTargetAsync(): Promise<any> {
        const res = await this.sendWorkerRequestAsync({
            type: "getAppTarget"
        }) as GetAppTargetResponse;

        return res.appTarget;
    }

    async supportsGhPackagesAsync(): Promise<boolean> {
        const res = await this.sendWorkerRequestAsync({
            type: "supportsGhPackages"
        }) as SupportsGhPackagesResponse;

        return res.supported;
    }

    async setHwVariantAsync(variant: string): Promise<void> {
        await this.sendWorkerRequestAsync({
            type: "setHwVariant",
            variant
        });
    }

    async getHardwareVariantsAsync(): Promise<pxt.PackageConfig[]> {
        const res = await this.sendWorkerRequestAsync({
            type: "getHardwareVariants"
        }) as GetHardwareVariantsResponse;

        return res.configs;
    }

    async getBundledPackageConfigsAsync(): Promise<pxt.PackageConfig[]> {
        const res = await this.sendWorkerRequestAsync({
            type: "getBundledPackageConfigs"
        }) as GetBundledPackageConfigsResponse;

        return res.configs;
    }

    async getCompileOptionsAsync(prj: Package, simpleOpts?: any): Promise<CompileOptions> {
        const res = await this.sendWorkerRequestAsync({
            type: "getCompileOptionsAsync",
            opts: simpleOpts
        }) as GetCompileOptionsAsyncResponse;

        return res.result;
    }

    async installGhPackagesAsync(projectFiles: pxt.Map<string>): Promise<pxt.Map<string>> {
        const res = await this.sendWorkerRequestAsync({
            type: "installGhPackagesAsync",
            files: projectFiles
        }) as InstallGhPackagesAsyncResponse;

        return res.result;
    }

    async setProjectTextAsync(projectFiles: pxt.Map<string>): Promise<void> {
        await this.sendWorkerRequestAsync({
            type: "setProjectText",
            files: projectFiles
        });
    }

    async performOperationAsync(op: string, options: any): Promise<any> {
        const res = await this.sendWorkerRequestAsync({
            type: "performOperation",
            op: op,
            data: options
        }) as PerformOperationResponse;

        return res.result;
    }

    async enableExperimentalHardwareAsync(): Promise<void> {
        await this.sendWorkerRequestAsync({
            type: "enableExperimentalHardware",
        });
    }

    async enableDebugAsync(): Promise<void> {
        await this.sendWorkerRequestAsync({
            type: "enableDebug",
        });
    }

    async setCompileSwitchesAsync(flags: string): Promise<void> {
        await this.sendWorkerRequestAsync({
            type: "setCompileSwitches",
            flags
        });
    }

    protected sendWorkerRequestAsync(message: ClientToWorkerRequest): Promise<ClientToWorkerRequestResponse> {
        message.id = this.nextID++;

        return new Promise(resolve => {
            this.pendingMessages[message.id] = resolve;
            this.worker.postMessage(message);
        });
    }

    protected onWorkerResponseReceived(message: ClientToWorkerRequestResponse) {
        if (this.pendingMessages[message.id]) {
            this.pendingMessages[message.id](message);
            delete this.pendingMessages[message.id];
        }
        else {
            console.warn("Received message with no callback");
        }
    }

    protected async onWorkerRequestReceived(message: WorkerToClientRequest) {
        switch (message.type) {
            case "cacheGet":
                this.sendWorkerRequestResponse({
                    ...message,
                    response: true,
                    value: await this.driverCallbacks.cacheGet(message.key)
                });
                break;
            case "cacheSet":
                await this.driverCallbacks.cacheSet(message.key, message.value);
                this.sendWorkerRequestResponse({
                    ...message,
                    response: true
                });
                break;
            case "packageOverride":
                this.sendWorkerRequestResponse({
                    ...message,
                    response: true,
                    files: await this.driverCallbacks.pkgOverrideAsync(message.packageId)
                });
                break;
        }
    }

    protected sendWorkerRequestResponse(message: WorkerToClientRequestResponse) {
        this.worker.postMessage(message);
    }
}