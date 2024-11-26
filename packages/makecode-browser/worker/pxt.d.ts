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
    interface JRes {
        id: string; // something like "sounds.bark"
        data: string;
        dataEncoding?: string; // must be "base64" or missing (meaning the same)
        icon?: string; // URL (usually data-URI) for the icon
        namespace?: string; // used to construct id
        mimeType: string;
        displayName?: string;
        tilemapTile?: boolean;
        tileset?: string[];
        tags?: string[];
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

declare namespace ts.pxtc {
    const enum SymbolKind {
        None,
        Method,
        Property,
        Function,
        Variable,
        Module,
        Enum,
        EnumMember,
        Class,
        Interface,
    }

    interface PropertyDesc {
        name: string;
        type: string;
    }

    interface PropertyOption {
        value: any;
    }

    interface ParameterDesc {
        name: string;
        description: string;
        type: string;
        pyTypeString?: string;
        initializer?: string;
        default?: string;
        properties?: PropertyDesc[];
        handlerParameters?: PropertyDesc[];
        options?: pxt.Map<PropertyOption>;
        isEnum?: boolean;
    }

    interface BlockBreak {
        kind: "break";
    }

    interface BlockImage {
        kind: "image";
        uri: string;
    }

    interface BlockLabel {
        kind: "label";
        text: string;
        style?: string[];
        cssClass?: string;
    }

    interface BlockParameter {
        kind: "param";
        ref: boolean;
        name: string;
        shadowBlockId?: string;
        varName?: string;
    }


    type BlockContentPart = BlockLabel | BlockParameter | BlockImage;
    type BlockPart = BlockContentPart | BlockBreak;

    interface ParsedBlockDef {
        parts: ReadonlyArray<(BlockPart)>;
        parameters: ReadonlyArray<BlockParameter>;
    }

    interface SymbolInfo {
        // attributes: CommentAttrs;

        // unqualified name (e.g. "Grass" instead of "Blocks.Grass")
        name: string;
        namespace: string;
        fileName: string;
        kind: SymbolKind;
        parameters: ParameterDesc[];
        retType: string;
        extendsTypes?: string[]; // for classes and interfaces
        isInstance?: boolean;
        isContextual?: boolean;
        // qualified name (e.g. "Blocks.Grass")
        qName?: string;
        pkg?: string;
        pkgs?: string[]; // for symbols defined in multiple packages
        snippet?: string;
        snippetName?: string;
        snippetWithMarkers?: string; // TODO(dz)
        pySnippet?: string;
        pySnippetName?: string;
        pySnippetWithMarkers?: string; // TODO(dz)
        blockFields?: ParsedBlockDef;
        isReadOnly?: boolean;
        combinedProperties?: string[];
        pyName?: string;
        pyQName?: string;
        snippetAddsDefinitions?: boolean;
        isStatic?: boolean;
    }

    interface ApisInfo {
        byQName: pxt.Map<SymbolInfo>;
        jres?: pxt.Map<pxt.JRes>;
    }
}
