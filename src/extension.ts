// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as gcr from './gcr_tunnel';

export var vscodeContext:vscode.ExtensionContext;


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "msra_intern_s_toolkit" is now active!');

	vscodeContext = context

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	context.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from MSRA Intern\'s Toolkit!');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.addGCRTunnel', () => {gcr.addTunnel()}));
	context.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.deleteGCRTunnel', () => {gcr.deleteTunnel()}));
	context.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.openGCRTunnel', () => {gcr.openTunnel()}));
	context.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.closeGCRTunnel', () => {gcr.closeTunnel()}));
	
	gcr.init();

	setInterval(() => {
		gcr.polling();
	}, 1000);
}

// this method is called when your extension is deactivated
export function deactivate() {}
