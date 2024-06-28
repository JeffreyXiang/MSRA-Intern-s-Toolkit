import * as vscode from 'vscode';
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
    domain: string;
    alias: string;
    isLoggedIn: boolean;

    constructor(init: any) {
        if (init.id) this.id = init.id;
        else this.id = uuid4();
        this.name = init.name;
        this.userDataPath = `userdata/${this.id}`;
        this.azureConfigDir = globalPath(`${this.userDataPath}/.azure`);
        this.domain = init.domain;
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
    saveFile('userdata/profiles.json', JSON.stringify({
        profiles: profiles.map(profile => {
            return {
                id: profile.id,
                name: profile.name,
                domain: profile.domain,
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
    if (exists('userdata/profiles.json')) {
        profiles = [];
        let cache = JSON.parse(getFile('userdata/profiles.json'));
        cache.profiles.forEach((profile: any) => {
            profiles.push(new Profile(profile));
        });
        activeProfileId = cache.activeProfile;
    }
}

async function addProfile() {
    let name = await vscode.window.showInputBox({prompt: 'Enter profile name'});
    if (name == undefined) return;
    let domain = await vscode.window.showInputBox({prompt: 'Enter domain'});
    if (domain == undefined) return;
    profiles.push(new Profile({name: name, domain: domain, alias: undefined}));
    updateProfiles();
}

async function manageProfiles() {
    let items: vscode.QuickPickItem[] = [];
    let label2profile: Map<string, Profile> = new Map();
    for (let profile of profiles) {
        let buttons: vscode.QuickInputButton[] = [];
        if (profile.isLoggedIn) buttons.push({iconPath: new vscode.ThemeIcon('log-out'), tooltip: 'Logout'});
        else buttons.push({iconPath: new vscode.ThemeIcon('log-in'), tooltip: 'Login'});
        buttons.push({iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Edit'});
        buttons.push({iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete'});
        let label = `\$(${profile.isLoggedIn ? 'pass' : 'circle-slash'}) ${profile.name}`;
        items.push({
            label: label,
            description: profile.alias ? `${profile.domain}.${profile.alias}` : profile.domain,
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
        else if (e.button.tooltip == 'Delete') {
            let selected = await vscode.window.showQuickPick(['Yes', 'No'], { title: `Are you sure you want to delete profile ${profile.name}?`, ignoreFocusOut: true });
            if (selected == 'Yes') {
                profiles = profiles.filter(p => p.id != profile.id);
                updateProfiles();
                manageProfiles();
            }
        }
    });
    panel.onDidHide(() => panel.dispose());
    panel.show();
}

async function setProfile(module: any, module_name: string) {
    let items: vscode.QuickPickItem[] = [];
    let label2profile: Map<string, Profile> = new Map();
    for (let profile of profiles) {
        let label = `\$(${profile.isLoggedIn ? 'pass' : 'circle-slash'}) ${profile.name}`;
        items.push({
            label: label,
            description: profile.alias ? `${profile.domain}.${profile.alias}` : profile.domain,
        });
        label2profile.set(label, profile);
    }
    let panel = vscode.window.createQuickPick();
    panel.items = items;
    panel.ignoreFocusOut = true;
    panel.title = `Select profile for ${module_name}`;
    let infoed = false;
    panel.onDidAccept(() => {
        let selected = panel.selectedItems[0];
        let profile = label2profile.get(selected.label)!;
        if (profile.isLoggedIn){
            activeProfileId[module_name] = profile.id;
            module.loggedOut();
            module.loggedIn(profile);
            saveProfileCache();
            panel.hide();
        }
        else {
            if (!infoed) {
                vscode.window.showInformationMessage('You can only select a profile that is logged in.');
                infoed = true;
            }
        }
    });
    panel.onDidHide(() => panel.dispose());
    panel.show();
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
            else {
                module.loggedIn(module.activeProfile);
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
    let domain = await vscode.window.showInputBox({prompt: 'Enter domain', value: profile.domain});
    if (domain == undefined) return;
    profile.name = name;
    profile.domain = domain;
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
