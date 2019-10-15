# MKC - command line tool for MakeCode editors

This repo contains a command line tool that uses published MakeCode editors, that normally
run in the browser.

It also includes a VSCode extension that uses the said tool.

## Prerequisites

npm and vscode

## Basic setup

While the extension isn't yet published in the VSCode gallery, you can install `.vsix` package by hand.
Once you have it, run the following from command line:

```bash
code --install-extension path/to/makecode-vscode-0.0.1.vsix
```

Now, you can run vscode in the project folder.
Alternatively, create an empty folder, go to the command palette (`Ctrl-Shift-P` or `Cmd-Shift-P`), search for
`makecode` and select `Create an empty MakeCode project`.

Once in a MakeCode project, right click somewhere in the code and select `Simulate MakeCode project`.
Simulator is restarted on save (which is often automatic).
Simulating will check for MakeCode-specific errors in the program.

The simulator has some buttons at the bottom.
* the `Build` button will create a `built/binary.uf2` but it doesn't communicate that well yet
* the `Console` button will bring up output of `console.log()` in your MakeCode program


## Building extension

If you want to build extension yourself, follow these steps.

```bash
cd vscode
npm install
npm run compile
```

Once you have it all set up, start VSCode (in the root directory of this repo) and in the debugger pane click "Launch extension".

Now clone a sample project, eg this one https://github.com/mmoskal/pxt-mkc-sample

In the VSCode window that lunched with extension, open the folder with that project.
Then open `main.ts` in the text editor, right click and select "Simulate MakeCode project".
Alternatively, open command palette and run the "Simulate MakeCode project" command.

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
