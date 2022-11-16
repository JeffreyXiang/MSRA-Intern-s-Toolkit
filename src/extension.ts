// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as cp from 'child_process'
import * as path from 'path'

var alias = 'FAREAST.v-jxiang'
var sandboxID = 1238

var tunnelStatus: string = 'closed'
var tunnelProc: cp.ChildProcessWithoutNullStreams

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "msra_intern_s_toolkit" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	context.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from MSRA Intern\'s Toolkit!');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.openBastionTunnel', () => {
		if (tunnelStatus == 'closed') {
			tunnelStatus = 'opening';
			console.log(`msra_intern_s_toolkit.openBastionTunnel: Exec powershell.exe ${path.join(context.extensionPath, 'script/gdl.ps1')} -tunnel -num ${sandboxID} -alias ${alias}`)
			tunnelProc = cp.spawn('powershell.exe', [path.join(context.extensionPath, 'script/gdl.ps1'), '-tunnel', '-num', `${sandboxID}`, '-alias', alias]);
			tunnelProc.stdout.on('data', (data) => {
				console.log(`msra_intern_s_toolkit.openBastionTunnel: ${data}`);
			});
			tunnelProc.stderr.on('data', (data) => {
				console.error(`msra_intern_s_toolkit.openBastionTunnel: ${data}`);
				if (String(data).indexOf('Tunnel is ready') != undefined)
					tunnelStatus = 'opened';
			});
			tunnelProc.on('exit', () => {
				tunnelStatus = 'closed';
				vscode.window.showErrorMessage('GCR Bastion Tunnel Closed. Reopen?', 'Yes', 'No').then((choice) => {
					if (choice == 'Yes') {
						vscode.commands.executeCommand('msra_intern_s_toolkit.openBastionTunnel');
					}
				});
			});
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.closeBastionTunnel', () => {
		if (tunnelStatus == 'opened') {
			tunnelProc.kill()
			tunnelStatus = 'closed';
		}
	}));
}

// this method is called when your extension is deactivated
export function deactivate() {}
