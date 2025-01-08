const path = require("path");
const child_process = require("child_process");
const fs = require("fs");

const packages = {
    "makecode-core": {
        name: "makecode-core",
        aliases: ["core", "c"]
    },
    "makecode-node": {
        name: "makecode",
        aliases: ["node", "n"]
    },
    "makecode-browser": {
        name: "makecode-browser",
        aliases: ["browser", "b"]
    }
};

const args = process.argv.slice(2);
const root = path.resolve(__dirname, "..");

const commandArg = args[0].toLowerCase();

if (commandArg === "bump") {
    bump(getPackageDirectory(args[1].toLowerCase(), args[2].toLowerCase()));
}
else if (commandArg === "publish") {
    publish();
}
else {
    console.error("Invalid command");
    printUsage();
    process.exit(1);
}

function bump(packageDirectory, versionType) {
    if (!isWorkingDirectoryClean()) {
        console.error("Working git directory not clean. Aborting");
        process.exit(1);
    }

    const versionTypes = ["patch", "minor", "major"];
    if (versionType && versionTypes.indexOf(versionType) === -1) {
        console.error("Invalid version type");
        printUsage();
        process.exit(1);
    }

    exec("git fetch origin master", root);
    exec("git checkout master", root);
    exec("git merge origin/master --ff-only", root);
    exec("npm version ", versionType, " --git-tag-version false", packageDirectory);

    const jsonPath = path.join(packageDirectory, "package.json");
    const json = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    const version = json.version;
    const packageName = json.name;

    const tagName = `${packageName}-v${version}`;

    exec(`git commit -am ${tagName}`, root);
    exec(`git tag ${tagName}`, root);
    exec(`git push origin master`, root);
    exec(`git push origin tag ${tagName}`, root);
}

function publish() {
    if (process.env.GITHUB_REF_TYPE !== "tag") {
        console.error("Workflow not invoked by a tagged commit. Aborting.");
        process.exit(0);
    }

    const tag = process.env.GITHUB_REF_NAME;

    const match = /^([a-z\-]+)-v\d+.\d+.\d+$/.exec(tag);

    if (!match) {
        console.error("Not a release tag. Aborting");
        process.exit(0);
    }
    const packageName = match[1];
    const packageDirectory = getPackageDirectory(packageName);

    const npmToken = process.env.NPM_ACCESS_TOKEN;

    if (!npmToken) {
        console.error("NPM_ACCESS_TOKEN not set. Aborting.");
        process.exit(1);
    }

    const npmrcPath = path.join(process.env.HOME, ".npmrc")
    const npmrc = `//registry.npmjs.org/:_authToken=${npmToken}\n`;

    console.log(`Writing ${npmrcPath}`);
    fs.writeFileSync(npmrcPath, npmrc);

    exec("npm publish", packageDirectory);
}

function printUsage() {
    console.log(`usage: node scripts/release.js bump core|node|browser patch|minor|major`);
}

function exec(command, cwd) {
    console.log(`${command}`)
    const result = execCore(command, cwd);

    if (result.status) {
        process.exit(result.status);
    }
}

function execCore(command, cwd) {
    const args = command.split(" ");
    const result = child_process.spawnSync(args[0], args.slice(1), { cwd, stdio: "inherit" });

    return result;
}

function isWorkingDirectoryClean() {
    const result = execCore("git diff-index --quiet HEAD --", root);
    if (result.status) {
        return false;
    }
    return true;
}

function getPackageDirectory(name) {
    let packageDirectory;
    for (const key of Object.keys(packages)) {
        const info = packages[key];

        if (key === name || info.name === name || info.aliases.indexOf(name) !== -1) {
            packageDirectory = key;
            break;
        }
    }

    if (!packageDirectory) {
        console.error("Invalid package");
        printUsage();
        process.exit(1);
    }

    return path.join(root, "packages", packageDirectory);
}