# MKC - command line tool for MakeCode editors

This repo contains a command line tool that uses published MakeCode editors, that normally
run in the browser.

It also includes a VSCode extension that uses the said tool.

## Prerequisites

npm and vscode

## Setup

```bash
cd makecode
npm install
npm run compile
cd ../vscode
npm install
npm run compile
```

Optionally, you can symlink makecode built folder like this:

```bash
cd vscode/node_modules/makecode
rm -rf built
ln -s ../../../makecode/built .
```

Once you have it all set up, open VScode in `vscode` folder and in the debugger pane say "Launch extension".

### Building vsix

```bash
npm install -g vsce
cd vscode
vsce package
```

## Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
