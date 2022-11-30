declare namespace pxt {
    type Map<T> = {
        [index: string]: T;
    };

    let appTarget: any;
    let webConfig: any;
    let options: any;

    interface SimpleDriverCallbacks {
        cacheGet: (key: string) => Promise<string>;
        cacheSet: (key: string, val: string) => Promise<void>;
        httpRequestAsync?: (options: any) => Promise<any>;
        pkgOverrideAsync?: (id: string) => Promise<Map<string>>;
    }
    interface SimpleCompileOptions {
        native?: boolean;
    }
    function simpleInstallPackagesAsync(files: pxt.Map<string>): Promise<void>;
    function simpleGetCompileOptionsAsync(files: pxt.Map<string>, simpleOptions: SimpleCompileOptions): Promise<any>;
    function setupSimpleCompile(cfg?: SimpleDriverCallbacks): void;
    function setHwVariant(variant: string): void;
    function getHwVariants(): any[];
    function savedAppTheme(): any;
    function reloadAppTargetVariant(): void;
    function setCompileSwitches(flags: string): void;
    function setupWebConfig(config: any): void;
}

declare namespace pxtc.service {
    function performOperation(op: string, data: any): any;
}

declare namespace ts.pxtc.assembler {
    let debug: boolean;
}