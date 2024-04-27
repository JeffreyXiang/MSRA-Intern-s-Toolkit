import * as vscode from 'vscode';
import * as cp from 'child_process'
import * as process from 'process'
import {vscodeContext, outputChannel} from './extension'
import {showErrorMessageWithHelp} from './utils'

var azureStatusBar: vscode.StatusBarItem;
export var domain: string;
export var alias: string;
export var isLoggedIn: boolean | undefined = undefined;
var bearerToken: string | undefined = undefined;
var tokenExpireTime: number | undefined = undefined;

function checkAccount() {
    outputChannel.appendLine('[CMD] > az account show');
    cp.exec('az account show', {env: process.env}, (error, stdout, stderr) => {
        if (stdout) {
            outputChannel.appendLine('[CMD OUT] ' + stdout);
            vscode.window.showQuickPick(['REDMOND', 'FAREAST'], { title: 'Select your domain' }).then((selectedItem) => {
                if (selectedItem) {
                    domain = selectedItem;
                    let username = JSON.parse(stdout).user.name;
                    alias = username.split('@')[0];
                    isLoggedIn = true;
                    vscode.commands.executeCommand('setContext', 'msra_intern_s_toolkit.isLoggedIn', true);
                    azureStatusBar.text = `$(msra-intern-s-toolkit) Login as: ${username}`;
                    vscode.window.showInformationMessage(`Succesfully login as: ${username}`);
                    return;
                }
                else {
                    isLoggedIn = false;
                    azureStatusBar.text = '$(msra-intern-s-toolkit) Click to login';
                    return;
                }
            });
        }
        if (error) {
            outputChannel.appendLine('[CMD ERR] ' + error.message);
            console.error(`msra_intern_s_toolkit.checkAccount: error - ${error.message}`);
            if (error.message.toString().includes('az login')) {
                isLoggedIn = false;
                azureStatusBar.text = '$(msra-intern-s-toolkit) Click to login';
                return;
            }
            else if (error.message.toString().includes('command not found') || error.message.toString().includes('not recognized')) {
                showErrorMessageWithHelp('Azure CLI not installed.');
                isLoggedIn = false;
                azureStatusBar.text = '$(msra-intern-s-toolkit) Click to login';
                return;
            }
        }
        if (stderr) {
            outputChannel.appendLine('[CMD ERR] ' + stderr);
            console.error(`msra_intern_s_toolkit.checkAccount: stderr - ${stderr}`);
            return;
        }
    });
}

function login() {
    vscode.window.showQuickPick(['REDMOND', 'FAREAST'], { title: 'Select your domain' }).then((selectedItem) => {
        if (selectedItem) {
            domain = selectedItem;
            vscode.window.withProgress(
                {location: vscode.ProgressLocation.Notification, cancellable: false}, 
                async (progress) => {
                    progress.report({message: "Waiting for authentication..."});
                    return new Promise<void> (resolve => {
                        outputChannel.appendLine('[CMD] > az login');
                        let args = ['login']
                        if (process.platform != 'win32') args.push('--use-device-code');
                        let proc = cp.spawn('az', args, {shell: true});
                        proc.stdout.on('data', (data) => {
                            let sdata = String(data);
                            outputChannel.appendLine('[CMD OUT] ' + sdata);
                            let username = JSON.parse(sdata)[0].user.name;
                            alias = username.split('@')[0];
                            isLoggedIn = true;
                            vscode.commands.executeCommand('setContext', 'msra_intern_s_toolkit.isLoggedIn', true);
                            azureStatusBar.text = `$(msra-intern-s-toolkit) Login as: ${username}`;
                            vscode.window.showInformationMessage(`Succesfully login as: ${username}`);
                            resolve();
                        });
                        proc.stderr.on('data', (data) => {
                            let sdata = String(data);
                            outputChannel.appendLine('[CMD ERR] ' + sdata);
                            console.error(`msra_intern_s_toolkit.login: error - ${sdata}`);
                            if (sdata.includes('To sign in, use a web browser to open the page')) {
                                let authcode = sdata.split(' ')[sdata.split(' ').length - 3];
                                vscode.window.showInformationMessage(sdata, 'Copy code and open browser').then((selectedItem) => {
                                    if (selectedItem == 'Copy code and open browser') {
                                        vscode.env.clipboard.writeText(authcode);
                                        vscode.env.openExternal(vscode.Uri.parse('https://microsoft.com/devicelogin'));
                                    }
                                });
                            }
                            else if (sdata.includes('re-authenticate')) {
                                vscode.window.showErrorMessage('Authentication Failed.');
                                login();
                                resolve();
                            }
                            else if (sdata.includes('command not found') || sdata.includes('not recognized')) {
                                showErrorMessageWithHelp('Azure CLI not installed.');
                                resolve();
                            }
                        });
                        proc.on('exit', code => {
                            if (code != 0 && code != null) vscode.window.showErrorMessage ('az failed with exit code ' + code);
                            resolve();
                        });
                    });			
                }
            );
        }
    });
}

function logout() {
	vscode.window.showQuickPick(['Yes', 'No'], { title: 'Are you sure you want to logout?' }).then((selectedItem) => {
        if (selectedItem == 'Yes') {
            outputChannel.appendLine('[CMD] > az logout');
            cp.execSync('az logout');
            isLoggedIn = false;
            vscode.commands.executeCommand('setContext', 'msra_intern_s_toolkit.isLoggedIn', false);
            azureStatusBar.text = '$(msra-intern-s-toolkit) Click to login';
        }
    })
}

export function getBearerToken() {
    if (bearerToken == undefined || tokenExpireTime == undefined || Date.now() > tokenExpireTime) {
        outputChannel.appendLine('[CMD] > az account get-access-token');
        let stdout = cp.execSync('az account get-access-token').toString();
        outputChannel.appendLine('[CMD OUT] ' + stdout);
        let token = JSON.parse(stdout);
        bearerToken = token.accessToken;
        tokenExpireTime = token.expires_on;
    }
    return bearerToken;
}

export function init() {
    outputChannel.appendLine('[INFO] Initializing Azure account module...');
    checkAccount();

    vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.azureAccount', () => {if (isLoggedIn != undefined) {isLoggedIn ? logout() : login()}}));

    azureStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
    azureStatusBar.command = 'msra_intern_s_toolkit.azureAccount'
    azureStatusBar.text = '$(msra-intern-s-toolkit) Checking account...';
    azureStatusBar.show();
}
