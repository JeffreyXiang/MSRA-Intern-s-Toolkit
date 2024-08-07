import * as vscode from 'vscode';
import * as fs from 'fs';
import {vscodeContext, outputChannel} from './extension'
import {showErrorMessageWithHelp, uuid4} from './utils'
import {getFile, saveFile, exists, globalPath} from './helper/file_utils'
import * as submitJobs from './submit_jobs'
import * as gcrTunnel from './gcr_tunnel'
import * as pim from './pim'
import * as azure from './helper/azure'

export class Profile {
    id: string;
    name: string;
    userDataPath: string;
    azureConfigDir: string;
    alias: string;
    isLoggedIn: boolean;

    constructor(init: any) {
        if (init.id) this.id = init.id;
        else this.id = uuid4();
        this.name = init.name;
        this.userDataPath = `${this.id}`;
        this.azureConfigDir = globalPath(`${this.userDataPath}/.azure`);
        this.alias = init.alias;
        this.isLoggedIn = false;
    }
}

var azureStatusBar: vscode.StatusBarItem;
export var profiles: Profile[] = [];
var activeProfileId: { [module: string]: string | undefined } = {};

const MODULES = [submitJobs, gcrTunnel, pim];
const MODULE_NAMES = ['submitJobs', 'gcrTunnel', 'pim'];


function saveProfileCache() {
    saveFile('profiles.json', JSON.stringify({
        profiles: profiles.map(profile => {
            return {
                id: profile.id,
                name: profile.name,
                alias: profile.alias
            };
        }),
        activeProfile: {
            'gcrTunnel': gcrTunnel.activeProfile ? gcrTunnel.activeProfile.id : undefined,
            'pim': pim.activeProfile ? pim.activeProfile.id : undefined,
            'submitJobs': submitJobs.activeProfile ? submitJobs.activeProfile.id : undefined,
        }
    }, null, 4));
}

function loadProfileCache() {
    if (exists('profiles.json')) {
        profiles = [];
        let cache = JSON.parse(getFile('profiles.json'));
        cache.profiles.forEach((profile: any) => {
            profiles.push(new Profile(profile));
        });
        activeProfileId = cache.activeProfile;
    }
}

async function addProfile() {
    let name = await vscode.window.showInputBox({prompt: 'Enter profile name'});
    if (name == undefined) return;
    let newProfile = new Profile({name: name, alias: undefined});
    try {
        fs.mkdirSync(globalPath(newProfile.userDataPath), {recursive: true});
    }
    catch (err) {
        showErrorMessageWithHelp(`Failed to create profile ${name}. ${err}`);
        return;
    }
    profiles.push(newProfile);
    updateProfiles();
    vscode.window.showInformationMessage(`Install Azure ML extension for profile ${name}? This is required for submitting jobs to Azure ML.`, 'Yes', 'No').then(async (selected) => {
        if (selected == 'Yes') {
            vscode.window.withProgress(
                {location: vscode.ProgressLocation.Notification, cancellable: false},
                (async (progress) => {
                    progress.report({message: "Installing Azure ML extension..."});
                    try {
                        await azure.extension.add('ml', undefined, undefined, newProfile.azureConfigDir);
                        vscode.window.showInformationMessage('Azure ML extension installed.');
                    } catch (err) {
                        showErrorMessageWithHelp('Failed to install Azure ML extension.');
                    }
                })
            );
        }
    });
}

async function manageProfiles() {
    let items: vscode.QuickPickItem[] = [];
    let label2profile: Map<string, Profile> = new Map();
    for (let profile of profiles) {
        let buttons: vscode.QuickInputButton[] = [];
        if (profile.isLoggedIn) buttons.push({iconPath: new vscode.ThemeIcon('log-out'), tooltip: 'Logout'});
        else buttons.push({iconPath: new vscode.ThemeIcon('log-in'), tooltip: 'Login'});
        buttons.push({iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Edit'});
        buttons.push({iconPath: new vscode.ThemeIcon('terminal'), tooltip: 'Open terminal'});
        buttons.push({iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete'});
        let label = `\$(${profile.isLoggedIn ? 'pass' : 'circle-slash'}) ${profile.name}`;
        items.push({
            label: label,
            description: profile.alias ? `${profile.alias}` : undefined,
            buttons: buttons,
        });
        label2profile.set(label, profile);
    }
    items.push({label: '$(add) Add profile'});
    
    let panel = vscode.window.createQuickPick();
    panel.items = items;
    panel.ignoreFocusOut = true;
    panel.title = 'Manage profiles';
    panel.onDidAccept(async () => {
        let selected = panel.selectedItems[0];
        if (selected.label == '$(add) Add profile') {
            panel.hide();
            await addProfile();
            manageProfiles();
        }
    });
    panel.onDidTriggerItemButton(async (e) => {
        let profile = label2profile.get(e.item.label)!;
        if (e.button.tooltip == 'Login') {
            login(profile);
        }
        else if (e.button.tooltip == 'Logout') {
            logout(profile);
        }
        else if (e.button.tooltip == 'Edit') {
            await editProfile(profile);
            manageProfiles();
        }
        else if (e.button.tooltip == 'Open terminal') {
            let terminal = vscode.window.createTerminal({
                name: `Azure CLI - ${profile.name}`,
                env: {
                    'AZURE_CONFIG_DIR': profile.azureConfigDir
                },
            });
            terminal.show();
        }
        else if (e.button.tooltip == 'Delete') {
            let selected = await vscode.window.showQuickPick(['Yes', 'No'], { title: `Are you sure you want to delete profile ${profile.name}?`, ignoreFocusOut: true });
            if (selected == 'Yes') {
                vscode.window.withProgress(
                    {location: vscode.ProgressLocation.Notification, cancellable: false},
                    (async (progress) => {
                        progress.report({message: `Deleting profile ${profile.name}...`});
                        try {
                            await new Promise<void>((resolve, reject) => fs.rmdir(globalPath(profile.userDataPath), {recursive: true}, (err) => err ? reject(err) : resolve()));
                        }
                        catch (err) {
                            showErrorMessageWithHelp(`Failed to delete profile ${profile.name}. ${err}`);
                            return;
                        }
                        profiles = profiles.filter(p => p.id != profile.id);
                        updateProfiles();
                        manageProfiles();
                    })
                );
            }
        }
    });
    panel.onDidHide(() => panel.dispose());
    panel.show();
}

export async function selectProfile(title: string): Promise<Profile | undefined> {
    return new Promise((resolve) => {
        let items: vscode.QuickPickItem[] = [];
        let label2profile: Map<string, Profile> = new Map();
        for (let profile of profiles) {
            let label = `\$(${profile.isLoggedIn ? 'pass' : 'circle-slash'}) ${profile.name}`;
            items.push({
                label: label,
                description: profile.alias ? `${profile.alias}` : undefined,
            });
            label2profile.set(label, profile);
        }
        let panel = vscode.window.createQuickPick();
        panel.items = items;
        panel.ignoreFocusOut = true;
        panel.title = title;
        let infoed = false;
        panel.onDidAccept(() => {
            let selected = panel.selectedItems[0];
            let profile = label2profile.get(selected.label)!;
            if (profile.isLoggedIn){
                resolve(profile);
                panel.dispose();
            }
            else {
                if (!infoed) {
                    vscode.window.showInformationMessage('You can only select a profile that is logged in.');
                    infoed = true;
                }
            }
        });
        panel.onDidHide(() => {
            resolve(undefined);
            panel.dispose();
        });
        panel.show();
    });
}

async function setProfile(module: any, module_name: string) {
    let prof = await selectProfile(`Select profile for ${module_name}`);
    if (prof == undefined) return;
    activeProfileId[module_name] = prof.id;
    if (module.activeProfile.id != prof.id) {
        module.loggedOut();
        module.loggedIn(prof);
    }
    saveProfileCache();
}

function updateProfiles() {
    let loggedIn = profiles.filter(profile => profile.isLoggedIn)
    if (loggedIn.length == 0) {
        vscode.commands.executeCommand('setContext', 'msra_intern_s_toolkit.isLoggedIn', false);
        azureStatusBar.text = '$(msra-intern-s-toolkit) Click to login';
    }
    else {
        vscode.commands.executeCommand('setContext', 'msra_intern_s_toolkit.isLoggedIn', true);
        azureStatusBar.text = `$(msra-intern-s-toolkit) Login as: ${loggedIn.map(profile => `${profile.name}(${profile.alias})`).join(', ')}`;
    }
    
    // Update module status
    for (let module of MODULES) {
        if (module.activeProfile != undefined) {
            if (!module.activeProfile.isLoggedIn) {
                module.loggedOut();
            }
        }
        if (module.activeProfile == undefined && loggedIn.length > 0) {
            module.loggedIn(loggedIn[0]);
        }
    }

    saveProfileCache();
}

async function checkProfiles() {
    let promises = profiles.map(profile => checkProfile(profile));
    let results = await Promise.allSettled(promises);
    if (results.some(result => result.status == 'rejected')) {
        if (results.filter(result => result.status == 'rejected')
                .some(result => (result as PromiseRejectedResult).reason == 'az_cli_not_installed')) {
            showErrorMessageWithHelp('Azure CLI not installed.');
            return;
        }
        showErrorMessageWithHelp('Failed to check profiles.');
    }

    for (let i = 0; i < MODULES.length; i++) {
        let profileId = activeProfileId[MODULE_NAMES[i]];
        if (profileId == undefined) continue;
        let profile = profiles.find(profile => profile.id == profileId);
        if (profile == undefined) {
            activeProfileId[MODULE_NAMES[i]] = undefined;
            continue;
        }
        if (profile.isLoggedIn) MODULES[i].loggedIn(profile);
    }
    
    updateProfiles();
}

async function checkProfile(profile: Profile) {
    let account;
    try {
        account = await azure.account.getAccount(profile.azureConfigDir);
    }
    catch (err) {
        if (err == 'not_logged_in') {
            profile.isLoggedIn = false;
            return;
        }
        else if (err == 'az_cli_not_installed') {
            profile.isLoggedIn = false;
            throw 'az_cli_not_installed';
        }
        else {
            profile.isLoggedIn = false;
            throw err;
        }
    }
    let alias = account.user.name.split('@')[0];
    if (profile.alias != undefined && alias != profile.alias) {
        let selected = await vscode.window.showWarningMessage(
            `The account is different from the previous login (${profile.alias} -> ${alias}). Continue?`,
            'Yes', 'No'
        );
        if (selected != 'Yes') {
            azure.account.logout(profile.azureConfigDir);
            return;
        }
    }
    profile.alias = alias;
    profile.isLoggedIn = true;
}

function showDevicelogin(authcode: string) {
    vscode.window.showInformationMessage(
        `To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ${authcode} to authenticate.`,
        'Copy code and open browser'
    ).then((selectedItem) => {
        if (selectedItem == 'Copy code and open browser') {
            vscode.env.clipboard.writeText(authcode);
            vscode.env.openExternal(vscode.Uri.parse('https://microsoft.com/devicelogin'));
        }
    });
}

async function login(profile: Profile) {
    vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false}, 
        async (progress) => {
            progress.report({message: "Waiting for authentication..."});
            let selected = await vscode.window.showQuickPick(['interactive', 'device code'], { title: 'Select your login method', ignoreFocusOut: true });
            if (selected == undefined) return;
            let account;
            try {
                if (selected == 'interactive') account = await azure.account.login(undefined, profile.azureConfigDir);
                else if (selected == 'device code') account = await azure.account.login(showDevicelogin, profile.azureConfigDir);
            }
            catch (err) {
                if (err == 'authentication_failed_reauthenticate') {
                    vscode.window.showErrorMessage('Authentication Failed.');
                    login(profile);
                }
                else if (err == 'az_cli_not_installed') {
                    showErrorMessageWithHelp('Azure CLI not installed.');
                }
                else {
                    showErrorMessageWithHelp(`Failed to login. ${err}`);
                }
                return;
            }
            let alias = account[0].user.name.split('@')[0];
            if (profile.alias != undefined && alias != profile.alias) {
                let selected = await vscode.window.showWarningMessage(
                    `The account is different from the previous login (${profile.alias} -> ${alias}). Continue?`,
                    'Yes', 'No'
                );
                if (selected != 'Yes') {
                    azure.account.logout(profile.azureConfigDir);
                    return;
                }
            }
            profile.alias = alias;
            profile.isLoggedIn = true;
            vscode.window.showInformationMessage(`Succesfully login ${profile.name}(${profile.alias})`);
            updateProfiles();
        }
    );
}

async function logout(profile: Profile) {
    let selected = await vscode.window.showQuickPick(['Yes', 'No'], { title: 'Are you sure you want to logout?', ignoreFocusOut: true });
    if (selected == 'Yes') {
        azure.account.logout(profile.azureConfigDir);
        profile.isLoggedIn = false;
        vscode.window.showInformationMessage(`Succesfully logout ${profile.name}(${profile.alias})`);
        updateProfiles();
    }
}

async function editProfile(profile: Profile) {
    let name = await vscode.window.showInputBox({prompt: 'Enter profile name', value: profile.name});
    if (name == undefined) return;
    profile.name = name;
    updateProfiles();
}

export function init() {
    outputChannel.appendLine('[INFO] Initializing Azure profile module...');
    loadProfileCache();
    checkProfiles();

    vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.manageProfiles', manageProfiles));
    vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.setGCRTunnelProfile', () => setProfile(gcrTunnel, 'gcrTunnel')));
    vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.setPIMProfile', () => setProfile(pim, 'pim')));
    vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.setSubmitJobsProfile', () => setProfile(submitJobs, 'submitJobs')));

    azureStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
    azureStatusBar.command = 'msra_intern_s_toolkit.manageProfiles'
    azureStatusBar.text = '$(msra-intern-s-toolkit) Checking profiles...'
    azureStatusBar.show();
}
