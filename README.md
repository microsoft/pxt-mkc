# MKC - command line tool for MakeCode editors

This package includes a tool that can compile MakeCode (PXT) projects by
downloading parts of a released MakeCode web app and running them in node.js.

This is different than `pxt` command line tool, which is used primarily during
development of MakeCode editors.

## Installation

Make sure to install [node.js](https://nodejs.org/).

To install `mkc` globally, run

```bash
npm install -g makecode
```

**Do not install the npm `mkc` package, it is another package.**

To update mkc,

```bash
npm install -u -g makecode
```

## Usage

The command line tool can be invoked as **`makecode`** or **`mkc`** for short.

### mkc init

To start a new [micro:bit](https://makecode.microbit.org) project in an empty folder:

```bash
mkc init microbit
```

where `microbit` is the template name. To get the list of supported templates, do `mkc help init`.

It is possible to specify a list of dependencies to be added to the template.

```bash
mkc init microbit jacdac jacdac-button jacdac-led
```

Your project is ready to be edited. If you are a Visual Studio Code user, type `code .` and you're ready to go!

### mkc install

This command downloads the sources of extensions to the file system so that your TypeScript
IDE can use them

```bash
mkc install
```

### mkc build

In a folder with `pxt.json` file, run the build command.

```bash
mkc build
```

Build is also the default command, so you can just leave it out.

```bash
mkc
```

You can also pass `--hw f4`, `--hw d5` etc. Try `--hw help` to get a list.
Use `mkc -j` to build JavaScript (it defaults to native).

To build and deploy to a device add `-d`.

```bash
mkc -d
```

The tool checks once a day if the MakeCode editor has been updated. However, you can force an update by using `--update`
during a build.

```bash
mkc --update
```

#### mkc build --watch

Use `--watch`, or `-w`, with `mkc build` to automatically watch changes in source files and rebuild automatically.

```bash
mkc -w
```

#### mkc build compile switches

Options can be passed to PXT compiler using `--compile-flags` (`-f`) option:

```bash
mkc -f size            # generate .csv file with function sizes
mkc -f asmdebug        # generate more comments in assembly listing
mkc -f profile         # enable profiling counters
mkc -f rawELF          # don't generate .UF2 but a raw ELF file
mkc -f size,asmdebug   # example with two options
```

The same options (except for `asmdebug`) can be passed to website with `?compiler=...` or `?compile=...` argument
and to the regular `pxt` command line utility with `PXT_COMPILE_SWITCHES=...`.

#### Built files in containers, GitHub Codespace, ...

To access the build files from a remote machine,

-   open Visual Studio Code
-   browse to the `built` folder
-   right click `Download` on the desired file.

### mkc serve

Use `mkc serve` to start a watch-build and localhost server with simulator.
Defaults to http://127.0.0.1:7001

```bash
mkc serve
```

You can change the port using `port`. 

```bash
mkc serve --port 7002
```

By default, the simulator ignores `loader.js`. If you have modifications in that file, use ``--force-local`` to use your `loader.js`.

```bash
mkc serve --force-local
```

### mkc clean

Run the clean command to erase build artifacts and cached packages.

```bash
mkc clean
```

### mkc search

Search for extensions hosted on GitHub.

```bash
mkc search jacdac
```

You can use the result with the `add` command to add extensions to your project.

### mkc add

Adds a new dependency to the project. Pass a GitHub repository URL to the `add` command.

```bash
mkc add https://github.com/microsoft/pxt-jacdac/button
```

For Jacdac extensions, simply write `jacdac-servicename`

```bash
mkc add jacdac-button
```

### mkc bump

Interactive update of the version number of the current project
and all nested projects in a mono-repo.

```bash
mkc bump
```

Use `--major`, `--minor`, `--patch` to automatically increment the version number.

```bash
mkc bump --patch
```

Adding `--version-file` will make `mkc` write a TypeScript file with the version number.

```bash
mkc bump --version-file version.ts
```

Add `--stage` to test the bump without pushing to git.

```bash
mkc bump --stage
```

### mkc download

Downloads a shared MakeCode project to files and initializes the project.

```bash
mkc download https://.....
```

## Advanced Configuration

The `init` commands creates a `mkc.json` file that you can also use for additional configurations.

```json
{
    "targetWebsite": "https://arcade.makecode.com/beta",
    "hwVariant": "samd51",
    "links": {
        "jacdac": "../../pxt-jacdac"
    },
    "overrides": {
        "testDependencies": {}
    },
    "include": ["../../common-mkc.json"]
}
```

All fields are optional.

-   **targetWebsite** says where to take the compiler from; if you omit it, it will be guessed based on packages used by `pxt.json`;
    you can point this to a live or beta version of the editor, as well as to a specific version (including SHA-indexed uploads
    generated during PXT target builds)
-   **hwVariant** specifies default hardware variant (currently only used in Arcade); try `--hw help` command line option to list variants
-   **links** overrides specific packages; these can be github packages or built-in packages
-   **overrides** is used to override specific keys in `pxt.json`
-   files listed in **include** are merged with the keys from the later ones overriding the keys from the earlier ones;
    the keys from the current file override all included keys

You can use `--config-path` or `-c` to build for a different configuration.

```bash
mkc -c mkc-arcade.json
```

## Local development

This section describes how to build mkc itself.

mkc is split into three packages:

1. makecode-core - which contains most of the functionality/shared code
2. makecode-node - which contains the node CLI (this is the package that is installed via `npm install makecode`)
3. makecode-browser - which contains a browser implementation of the mkc language service

### Building
 
-   install node.js
-   run `yarn install` from the root of this repo (this will also link the local packages)
-   start the build watch in makecode-core and makecode-node:
    - (run these in separate terminals) 
    - `cd packages/makecode-core && yarn watch`
    - `cd packages/makecode-node && yarn watch`
-   run `node path/to/pxt-mkc/packages/makecode-node/makecode` in your project folder

If you want to test out changes in pxt, first run the build as usual, and then replace
`$HOME/.pxt/mkc-cache/https_58__47__47_<your-editor>-pxtworker.js`
with `pxt/built/web/pxtworker.js`.
Make sure to run `makecode` tool without the `-u` option.

### Releases

A new release will be automatically generated by the build system based on these
commit naming guidelines.

-   **feat:** A new feature
-   **fix:** A bug fix
-   **docs:** Documentation only changes
    style: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
-   **refactor:** A code change that neither fixes a bug nor adds a feature
-   **perf:** A code change that improves performance
-   **test:** Adding missing or correcting existing tests
-   **chore:** Changes to the build process or auxiliary tools and libraries such as documentation generation

### Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
