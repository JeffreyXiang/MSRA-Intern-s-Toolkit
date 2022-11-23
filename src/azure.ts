import * as vscode from 'vscode';
import * as cp from 'child_process'
import * as process from 'process'
import {vscodeContext} from './extension'
import {showErrorMessageWithHelp} from './utils'

var azureStatusBar: vscode.StatusBarItem;
export var alias: string;
export var isLoggedIn: boolean | undefined = undefined;

function checkAccount() {
    cp.exec('az account show', {env: process.env}, (error, stdout, stderr) => {
        if (stdout) {
            let username = JSON.parse(stdout).user.name;
            alias = `FAREAST.${username.split('@')[0]}`;
            isLoggedIn = true;
            vscode.commands.executeCommand('setContext', 'msra_intern_s_toolkit.isLoggedIn', true);
            azureStatusBar.text = `$(msra-intern-s-toolkit) Login as: ${username}`;
            vscode.window.showInformationMessage(`Succesfully login as: ${username}`);
            return;
        }
        if (error) {
            console.error(`msra_intern_s_toolkit.checkAccount: error - ${error.message}`);
            if (error.message.toString().includes('az login')) {
                isLoggedIn = false;
                azureStatusBar.text = '$(msra-intern-s-toolkit) Click to login';
                return;
            }
            else{
                showErrorMessageWithHelp('Azure CLI not installed.');
                isLoggedIn = false;
                azureStatusBar.text = '$(msra-intern-s-toolkit) Click to login';
                return;
            }
        }
        if (stderr) {
            console.error(`msra_intern_s_toolkit.checkAccount: stderr - ${stderr}`);
            return;
        }
    });
}

function login() {
    vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false}, 
        async (progress) => {
            progress.report({message: "Waiting for authentication..."});
            return new Promise<void> (resolve => {
                cp.exec('az login', {env: process.env}, (error, stdout, stderr) => {
                    if (stdout) {
                        let username = JSON.parse(stdout)[0].user.name;
                        alias = `FAREAST.${username.split('@')[0]}`;
                        isLoggedIn = true;
                        vscode.commands.executeCommand('setContext', 'msra_intern_s_toolkit.isLoggedIn', true);
                        azureStatusBar.text = `$(msra-intern-s-toolkit) Login as: ${username}`;
                        vscode.window.showInformationMessage(`Succesfully login as: ${username}`);
                        return;
                    }
                    if (error) {
                        console.error(`msra_intern_s_toolkit.login: error - ${error.message}`);
                        if (error.message.toString().includes('re-authenticate')) {
                            vscode.window.showErrorMessage('Authentication Failed.');
                            login();
                            return;
                        }
                        else{
                            showErrorMessageWithHelp('Azure CLI not installed.');
                            return;
                        }
                        
                    }
                    if (stderr) {
                        console.error(`msra_intern_s_toolkit.login: stderr - ${stderr}`);
                        return;
                    }
                }).on('exit', code => resolve());
            });			
        }
    );
}

function logout() {
	vscode.window.showQuickPick(['Yes', 'No'], { title: 'Are you sure you want to logout?' }).then((selectedItem) => {
        if (selectedItem == 'Yes') {
            cp.execSync('az logout');
            isLoggedIn = false;
            vscode.commands.executeCommand('setContext', 'msra_intern_s_toolkit.isLoggedIn', false);
            azureStatusBar.text = '$(msra-intern-s-toolkit) Click to login';
        }
    })
}

export function init() {
    checkAccount();

    vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.azureAccount', () => {if (isLoggedIn != undefined) {isLoggedIn ? logout() : login()}}));

    azureStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
    azureStatusBar.command = 'msra_intern_s_toolkit.azureAccount'
    azureStatusBar.text = '$(msra-intern-s-toolkit) Checking account...';
    azureStatusBar.show();
}
