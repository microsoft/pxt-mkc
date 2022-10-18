interface WorkerMessage {
    id?: number;
}

interface BaseResponse extends WorkerMessage {
    response: true;
}

interface RegisterDriverCallbacksRequest extends WorkerMessage {
    type: "registerDriverCallbacks";
}

interface RegisterDriverCallbacksResponse extends BaseResponse {
    type: "registerDriverCallbacks";
}

interface SetWebConfigRequest extends WorkerMessage {
    type: "setWebConfig";
    webConfig: any;
}

interface SetWebConfigResponse extends BaseResponse {
    type: "setWebConfig";
}

interface GetWebConfigRequest extends WorkerMessage {
    type: "getWebConfig";
}

interface GetWebConfigResponse extends BaseResponse {
    type: "getWebConfig";
    webConfig: any;
}

interface GetAppTargetRequest extends WorkerMessage {
    type: "getAppTarget";
}

interface GetAppTargetResponse extends BaseResponse {
    type: "getAppTarget";
    appTarget: any;
}

interface SupportsGhPackagesRequest extends WorkerMessage {
    type: "supportsGhPackages";
}

interface SupportsGhPackagesResponse extends BaseResponse {
    type: "supportsGhPackages";
    supported: boolean;
}

interface SetHwVariantRequest extends WorkerMessage {
    type: "setHwVariant";
    variant: string;
}

interface SetHwVariantResponse extends BaseResponse {
    type: "setHwVariant";
}

interface GetHardwareVariantsRequest extends WorkerMessage {
    type: "getHardwareVariants";
}

interface GetHardwareVariantsResponse extends BaseResponse {
    type: "getHardwareVariants";
    configs: any[];
}

interface GetBundledPackageConfigsRequest extends WorkerMessage {
    type: "getBundledPackageConfigs";
}

interface GetBundledPackageConfigsResponse extends BaseResponse {
    type: "getBundledPackageConfigs";
    configs: any[];
}

interface GetCompileOptionsAsyncRequest extends WorkerMessage {
    type: "getCompileOptionsAsync";
    opts: any;
}

interface GetCompileOptionsAsyncResponse extends BaseResponse {
    type: "getCompileOptionsAsync";
    result: any;
}

interface InstallGhPackagesAsyncRequest extends WorkerMessage {
    type: "installGhPackagesAsync";
    files: pxt.Map<string>;
}

interface InstallGhPackagesAsyncResponse extends BaseResponse {
    type: "installGhPackagesAsync";
    result: pxt.Map<string>;
}

interface PerformOperationRequest extends WorkerMessage {
    type: "performOperation";
    op: string;
    data: any;
}

interface PerformOperationResponse extends BaseResponse {
    type: "performOperation";
    result: any;
}

interface SetProjectTextRequest extends WorkerMessage {
    type: "setProjectText";
    files: pxt.Map<string>;
}

interface SetProjectTextResponse extends BaseResponse {
    type: "setProjectText";
}

interface EnableExperimentalHardwareRequest extends WorkerMessage {
    type: "enableExperimentalHardware";
}

interface EnableExperimentalHardwareResponse extends BaseResponse {
    type: "enableExperimentalHardware";
}

interface EnableDebugRequest extends WorkerMessage {
    type: "enableDebug";
}

interface EnableDebugResponse extends BaseResponse {
    type: "enableDebug";
}

interface SetCompileSwitchesRequest extends WorkerMessage {
    type: "setCompileSwitches";
    flags: string;
}

interface SetCompileSwitchesResponse extends BaseResponse {
    type: "setCompileSwitches";
}

type ClientToWorkerRequest = RegisterDriverCallbacksRequest | SetWebConfigRequest | GetWebConfigRequest
| GetAppTargetRequest | SupportsGhPackagesRequest | SetHwVariantRequest | GetHardwareVariantsRequest
| GetBundledPackageConfigsRequest | GetCompileOptionsAsyncRequest | InstallGhPackagesAsyncRequest
| PerformOperationRequest | SetProjectTextRequest | EnableExperimentalHardwareRequest
| EnableDebugRequest | SetCompileSwitchesRequest;

type ClientToWorkerRequestResponse = RegisterDriverCallbacksResponse | SetWebConfigResponse | GetWebConfigResponse
| GetAppTargetResponse | SupportsGhPackagesResponse | SetHwVariantResponse | GetHardwareVariantsResponse
| GetBundledPackageConfigsResponse | GetCompileOptionsAsyncResponse | InstallGhPackagesAsyncResponse
| PerformOperationResponse | SetProjectTextResponse | EnableExperimentalHardwareResponse
| EnableDebugResponse | SetCompileSwitchesResponse;


interface BaseWorkerToClientRequest extends WorkerMessage {
    kind: "worker-to-client";
}

interface BaseWorkerToClientRequestResponse extends BaseWorkerToClientRequest {
    response: true;
}

interface CacheSetRequest extends BaseWorkerToClientRequest {
    type: "cacheSet";
    key: string;
    value: string;
}

interface CacheSetResponse extends BaseWorkerToClientRequestResponse {
    type: "cacheSet";
}

interface CacheGetRequest extends BaseWorkerToClientRequest {
    type: "cacheGet";
    key: string;
}

interface CacheGetResponse extends BaseWorkerToClientRequestResponse {
    type: "cacheGet";
    value: string;
}

interface PackageOverrideRequest extends BaseWorkerToClientRequest {
    type: "packageOverride";
    packageId: string;
}

interface PackageOverrideResponse extends BaseWorkerToClientRequestResponse {
    type: "packageOverride";
    files: pxt.Map<string>;
}

type WorkerToClientRequest = CacheSetRequest | CacheGetRequest | PackageOverrideRequest;

type WorkerToClientRequestResponse = CacheSetResponse | CacheGetResponse | PackageOverrideResponse;