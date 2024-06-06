// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as account from './account';
import * as job from './submit_jobs';
import * as gcr from './gcr_tunnel';

export var vscodeContext:vscode.ExtensionContext;
export var outputChannel:vscode.OutputChannel = vscode.window.createOutputChannel('MSRA Intern\'s Toolkit');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "msra-intern-s-toolkit" is now active!');

	vscodeContext = context;

	context.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.start', () => {
		vscode.commands.executeCommand('setContext', 'msra_intern_s_toolkit.isStarted', true);
		account.init();
		job.init();
		gcr.init();
	}));
}

// this method is called when your extension is deactivated
export function deactivate() {}
