import { applyGlobalOptions, getAPIInfo, ProjectOptions, resolveProject } from "makecode-core/built/commands";

import * as fs from "fs";
import * as path from "path";

export interface GenerateDocsOptions extends ProjectOptions {
    outDir?: string;
    repoName: string;
    annotate?: boolean;
}

interface APIInfo {
    byQName: {[index: string]: SymbolInfo};
}

interface SymbolInfo {
    kind: number;
    qName: string;
    namespace: string;
    name: string;
    fileName: string;
    attributes: {
        block?: string;
        jsDoc?: string;
        paramHelp: {[index: string]: string};
    }
    parameters: ParameterInfo[];
}

interface ParameterInfo {
    name: string;
    description: string;
    type: string;
}

export async function generateDocsCommand(opts: GenerateDocsOptions) {
    if (!opts.repoName) {
        throw new Error("Repository name is required. Use --repo-name to specify it.");
    }

    applyGlobalOptions(opts);
    const proj = await resolveProject(opts);
    const config = await proj.readPxtConfig();
    const apiInfo: APIInfo = await getAPIInfo(opts);

    const outDir = opts.outDir ? path.resolve(opts.outDir) : path.resolve(proj.directory, "docs");
    const generatedFiles: string[] = [];

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    let helpAnnotations: {[index: string]: string} = {};

    for (const qName of Object.keys(apiInfo.byQName)) {
        const sym = apiInfo.byQName[qName];
        if (
            sym.kind !== 3 ||
            !sym.attributes.block ||
            !config.files.includes(sym.fileName)
        ) continue;

        const fileName = getFileName(sym.name);

        const fullPath = path.join(outDir, fileName);
        const relativePath = path.relative(proj.directory, fullPath);

        if (fs.existsSync(fullPath)) {
            console.log(`Skipping existing file: ${relativePath}`);
            continue;
        }

        const snippet = await proj.service.getSnippetAsync(proj.mainPkg, sym.qName, true);
        if (!snippet) {
            console.log(`No snippet found for ${sym.qName}, skipping.`);
            continue;
        }

        generatedFiles.push(path.relative(proj.directory, fullPath));
        const file = generateMarkdownForSymbol(
            sym,
            config,
            snippet,
            opts.repoName
        );
        fs.writeFileSync(fullPath, file, { encoding: "utf8" });
        console.log(`Wrote: ${relativePath}`);
        helpAnnotations[sym.attributes.block] = `//% help=github:${config.name}/${relativePath.replace(/\.md$/, "")}`;
    }

    if (generatedFiles.length) {
        for (const file of generatedFiles) {
            if (!config.files.includes(file)) {
                config.files.push(file);
            }
        }
        fs.writeFileSync(
            path.join(proj.directory, "pxt.json"),
            JSON.stringify(config, null, 4),
            { encoding: "utf8" }
        );
        console.log(`Updated pxt.json with ${generatedFiles.length} new files.`);
    }
    else {
        console.log(`No new documentation files were generated.`);
    }

    if (opts.annotate && Object.keys(helpAnnotations).length > 0) {
        for (const file of config.files) {
            if (!file.endsWith(".ts")) continue;

            const filePath = path.resolve(proj.directory, file);
            let content = fs.readFileSync(filePath, { encoding: "utf8" });
            let modified = false;

            for (const block of Object.keys(helpAnnotations)) {
                const helpAnnotation = helpAnnotations[block];

                const blockString = `block="${block}"`;
                const index = content.indexOf(blockString);

                if (content.indexOf(helpAnnotation) === -1 && index !== -1) {
                    const insertPos = content.indexOf("\n", index) + 1;
                    const lineStart = content.lastIndexOf("\n", index) + 1;

                    let indent = "";
                    for (let i = lineStart; i < index; i++) {
                        const char = content[i];
                        if (char === " " || char === "\t") {
                            indent += char;
                        } else {
                            break;
                        }
                    }

                    content =
                        content.slice(0, insertPos) +
                        `${indent}${helpAnnotation}\n` +
                        content.slice(insertPos);
                    modified = true;

                    delete helpAnnotations[block];
                }
            }
            if (modified) {
                fs.writeFileSync(filePath, content, { encoding: "utf8" });
                console.log(`Annotated help comments in: ${path.relative(proj.directory, filePath)}`);
            }
        }
    }
}

function getFileName(apiName: string): string {
    return getNameParts(apiName).join("-") + ".md";
}

function getNameParts(apiName: string): string[] {
    const parts: string[] = [];
    let currentPart = "";

    for (let i = 0; i < apiName.length; i++) {
        if (i > 0 && apiName[i] === apiName[i].toUpperCase() && apiName[i - 1] === apiName[i - 1].toLowerCase()) {
            parts.push(currentPart);
            currentPart = "";
        }
        currentPart += apiName[i].toLowerCase();
    }
    if (currentPart) {
        parts.push(currentPart);
    }
    return parts;
}

function generateMarkdownForSymbol(sym: SymbolInfo, config: pxt.PackageConfig, snippet: string, repoName: string): string {
    const jsDoc = sym.attributes.jsDoc || "";
    const lines = jsDoc
    .split("\n")
    .map(l => l.trim())
    .filter(l => !l.startsWith("@") && !l.startsWith("*") && l.length > 0);

    let md = `# ${getNameParts(sym.name).join(" ")}\n\n`;
    md += lines.join(" ") + "\n\n";

    md += "```sig\n"
    md += snippet + "\n" //todo
    md += "```\n\n"

    if (sym.parameters.length > 0) {
        md += "## Parameters\n\n";
        for (const param of sym.parameters) {
            let description = param.description;
            if (!description) {
                description = "A " + param.type;
            }
            md += `* **${param.name}**: ${description}\n`;
        }
        md += "\n";
    }

    md += "```package\n";
    md += `${config.name}=github:${repoName}\n`;
    md += "```\n";

    return md;
}
