export interface Host {
    readFileAsync(path: string, encoding?: "utf8"): Promise<string>;
    writeFileAsync(path: string, content: any, encoding?: "base64" | "utf8"): Promise<void>;
    mkdirAsync(path: string): Promise<void>;
    existsAsync(path: string): Promise<boolean>;
    unlinkAsync(path: string): Promise<void>;
    symlinkAsync(target: string, path: string, type: "file"): Promise<void>;
    listFilesAsync(directory: string, filename: string): Promise<string[]>;
}

export function setHost(newHost: Host) {
    host = newHost;
}

export let host: Host;