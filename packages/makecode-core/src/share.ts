import * as path from "path"

import { host } from "./host";
import { ProjectOptions, resolveProject } from "./commands";
import { WebConfig } from "./downloader";
import { Project } from "./mkc";


// This is copied from pxt. Should be kept up to date with that version
interface InstallHeader {
    name: string; // script name, should always be in sync with pxt.json name
    meta: any; // script meta data
    editor: string; // editor that we're in
    board?: string; // name of the package that contains the board.json info
    temporary?: boolean; // don't serialize project
    // older script might miss this
    target: string;
    // older scripts might miss this
    targetVersion: string;
    pubId: string; // for published scripts
    pubCurrent: boolean; // is this exactly pubId, or just based on it
    // pubVersions?: PublishVersion[];
    pubPermalink?: string; // permanent (persistent) share ID
    anonymousSharePreference?: boolean; // if true, default to sharing anonymously even when logged in
    githubId?: string;
    githubTag?: string; // the release tag if any (commit.tag)
    githubCurrent?: boolean;
    // workspace guid of the extension under test
    extensionUnderTest?: string;
    // id of cloud user who created this project
    cloudUserId?: string;
    isSkillmapProject?: boolean;

    id: string; // guid (generated by us)
    path?: string; // for workspaces that require it
    recentUse: number; // seconds since epoch
    modificationTime: number; // seconds since epoch
    icon?: string; // icon uri
    saveId?: any; // used to determine whether a project has been edited while we're saving to cloud
    pubVersions?: any[];
}

const apiRoot = "https://www.makecode.com";

export async function shareProjectAsync(opts: ProjectOptions) {
    const prj = await resolveProject(opts);
    const req = await createShareLinkRequestAsync(prj);

    let siteRoot = new URL(prj.editor.website).origin;
    if (!siteRoot.endsWith("/")) {
        siteRoot += "/";
    }

    const res = await host().requestAsync({
        url: apiRoot + "/api/scripts",
        data: req
    });

    if (res.statusCode === 200) {
        const resJSON = JSON.parse(res.text!)
        return siteRoot + resJSON.shortid
    }

    return undefined
}

async function createShareLinkRequestAsync(prj: Project) {
    const theHost = host();

    const config = await prj.readPxtConfig();

    const files: {[index: string]: string} = {
        "pxt.json": JSON.stringify(config)
    };

    for (const file of config.files) {
        const content = await theHost.readFileAsync(path.join(prj.directory, file), "utf8");
        files[file] = content;
    }

    if (config.testFiles) {
        for (const file of config.testFiles) {
            const content = await theHost.readFileAsync(path.join(prj.directory, file), "utf8");
            files[file] = content;
        }
    }

    const target = await prj.service.languageService.getAppTargetAsync();

    const header: InstallHeader = {
        "name": config.name,
        "meta": {
            "versions": target.versions
        },
        "editor": "tsprj",
        "pubId": undefined,
        "pubCurrent": false,
        "target": target.id,
        "targetVersion": target.versions.target,
        "id": theHost.guidGen?.() || "",
        "recentUse": Date.now(),
        "modificationTime": Date.now(),
        "path": config.name,
        "saveId": {},
        "githubCurrent": false,
        "pubVersions": []
    }

    return {
        id: header.id,
        name: config.name,
        target: target.id,
        targetVersion: target.versions.target,
        description: config.description || `Made with ❤️ in MakeCode.`,
        editor: "tsprj",
        header: JSON.stringify(header),
        text: JSON.stringify(files),
        meta: {
            versions: target.versions
        }
    }
}