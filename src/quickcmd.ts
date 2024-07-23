import * as vscode from 'vscode';
import {vscodeContext, outputChannel} from './extension'
import {exists, getFile} from './helper/file_utils'
import * as profile from './profile'
import * as azure from './helper/azure'

var quickCmdButton: vscode.StatusBarItem;
var activeTerminal: vscode.Terminal | undefined;

async function selectBlobContainerFromSubscription(prof: profile.Profile): Promise<azure.storage.BlobContainer | undefined> {
    let subscriptions = await vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false},
        (async (progress) => {
            progress.report({message: "Fetching subscriptions..."});
            try {
                return await azure.account.getSubscriptions(true, prof!.azureConfigDir);
            } catch (err) {
                vscode.window.showErrorMessage('Failed to get subscriptions');
            }
        })
    );
    if (subscriptions === undefined) return;
    let selected = await vscode.window.showQuickPick(subscriptions.map(sub => sub.name), { title: 'Select a subscription', ignoreFocusOut: true });
    if (selected === undefined) return;
    let subscription = subscriptions.find(sub => sub.name === selected)!.id;

    let storageAccounts = await vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false},
        (async (progress) => {
            progress.report({message: "Fetching storage accounts..."});
            try {
                return await azure.storage.getAccounts(subscription, prof.azureConfigDir);
            } catch (err) {
                vscode.window.showErrorMessage('Failed to get storage accounts');
            }
        })
    );
    if (storageAccounts === undefined) return;
    selected = await vscode.window.showQuickPick(storageAccounts.map(acc => acc.name), { title: 'Select a storage account', ignoreFocusOut: true });
    if (selected === undefined) return;
    let account = storageAccounts.find(acc => acc.name === selected)!;

    let containers = await vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false},
        (async (progress) => {
            progress.report({message: "Fetching blob containers..."});
            try {
                return await azure.storage.getContainers(account, prof.azureConfigDir);
            } catch (err) {
                vscode.window.showErrorMessage('Failed to get blob containers');
            }
        })
    );
    if (containers === undefined) return;
    selected = await vscode.window.showQuickPick(containers.map(cont => cont.name), { title: 'Select a blob container', ignoreFocusOut: true });
    if (selected === undefined) return;
    return containers.find(cont => cont.name === selected)!;
}

async function selectBlobContainerFromDatastore(prof: profile.Profile): Promise<azure.storage.BlobContainer | undefined> {
    return new Promise(async (resolve) => {
        let cachePath = `${prof.userDataPath}/resource_cache.json`;
        if (!exists(cachePath)) {
            vscode.window.showErrorMessage('No available datastores');
            return;
        }
        let datastores: azure.ml.Datastore[] = JSON.parse(getFile(cachePath)).datastores.map(
            (v: any) => azure.ml.Datastore.fromJSON(v)
        );
        if (datastores.length === 0) {
            vscode.window.showErrorMessage('No available datastores');
            return;
        }
        
        let items: vscode.QuickPickItem[] = datastores.map(ds => {
            return {
                label: ds.name,
                description: `${ds.blobContainer.storageAccount.name}/${ds.blobContainer.name}`
            };
        });
   
        let panel = vscode.window.createQuickPick();
        panel.items = items;
        panel.ignoreFocusOut = true;
        panel.title = 'Select a datastore';
        panel.onDidAccept(() => {
            let selected = panel.selectedItems[0];
            let datastore = datastores.find(ds => ds.name === selected.label)!;
            resolve(datastore.blobContainer);
            panel.dispose();
        });
        panel.onDidHide(() => {
            resolve(undefined);
            panel.dispose();
        });
        panel.show();
    });    
}

async function selectBlobContainer(prof: profile.Profile): Promise<azure.storage.BlobContainer | undefined> {
    let howToSelect = await vscode.window.showQuickPick([
        'Select from subscriptions',
        'Select from managed datastores',
    ], { title: 'How to select the storage account?', ignoreFocusOut: true });
    
    let container: azure.storage.BlobContainer | undefined;
    switch (howToSelect) {
        case 'Select from subscriptions':
            container = await selectBlobContainerFromSubscription(prof);
            break;
        case 'Select from managed datastores':
            container = await selectBlobContainerFromDatastore(prof);
            break;
    }
    return container;
}

async function generateSAS(prof: profile.Profile): Promise<string | undefined> {
    let container = await selectBlobContainer(prof);
    if (container === undefined) return;

    let days = await vscode.window.showInputBox({
        title: 'Enter the number of days the SAS token should last',
        value: '7',
        ignoreFocusOut: true,
    });
    if (days === undefined) return;
    let daysInt = parseInt(days);
    if (isNaN(daysInt)) {
        vscode.window.showErrorMessage('Invalid number of days');
        return;
    }

    let permissions = await vscode.window.showInputBox({
        title: 'Enter the permissions for the SAS token',
        value: 'acdlrw',
        prompt: 'The permissions the SAS grants. Should be a combination of the following:\n' +
                '(a)dd\n' + 
                '(c)reate\n' +
                '(d)elete\n' +
                '(e)xecute\n' +
                '(f)ilter_by_tags\n' +
                '(i)set_immutability_policy\n' +
                '(l)ist\n' +
                '(m)ove\n' +
                '(r)ead\n' +
                '(t)ag\n' +
                '(w)rite\n' +
                '(x)delete_previous_version\n' +
                '(y)permanent_delete',
        ignoreFocusOut: true,
    });
    if (permissions === undefined || permissions.trim() === '') return;

    let expiry = new Date();
    expiry.setDate(expiry.getDate() + daysInt);
    let expiryStr = expiry.toISOString().split('.')[0] + 'Z';
    let cmd = `az storage container generate-sas --account-name ${container.storageAccount.name} --name ${container.name} --as-user --auth-mode login --expiry ${expiryStr} --permissions ${permissions} --https-only --subscription ${container.storageAccount.subscription}`;
    return cmd;
}

async function getAzcopyPath(title: string, prof: profile.Profile): Promise<string | undefined> {
    let selected = await vscode.window.showQuickPick([
        'Local Path',
        'Blob Container',
    ], { title: title, ignoreFocusOut: true });
    if (selected === undefined) return;
    switch (selected) {
        case 'Local Path':
            let localPath = await vscode.window.showInputBox({title: 'Enter the local path', ignoreFocusOut: true});
            if (localPath === undefined || localPath.trim() === '') return;
            return localPath;
        case 'Blob Container':
            let container = await selectBlobContainer(prof);
            if (container === undefined) return;
            let blobPath = await vscode.window.showInputBox({title: 'Enter the blob path', ignoreFocusOut: true});
            if (blobPath === undefined) return;
            let sas = await vscode.window.withProgress(
                {location: vscode.ProgressLocation.Notification, cancellable: false},
                (async (progress) => {
                    progress.report({message: 'Generating SAS token...'});
                    return (await container!.generateSAS(7, 'acdlrw', prof.azureConfigDir)).token;
                })
            );
            return `${container.uri}/${blobPath}?${sas}`;
    }
}

async function azcopy(prof: profile.Profile): Promise<string | undefined> {
    let args: string[] = ['azcopy copy'];

    let source = await getAzcopyPath('Select the source', prof);
    if (source === undefined) return;
    args.push(`"${source}"`);

    let dest = await getAzcopyPath('Select the destination', prof);
    if (dest === undefined) return;
    args.push(`"${dest}"`);

    let isRecursive = await vscode.window.showQuickPick(['Yes', 'No'], { title: 'Should the copy be recursive?', ignoreFocusOut: true });
    if (isRecursive === undefined) return;
    if (isRecursive === 'Yes') {
        args.push('--recursive');
    }

    let cmd = args.join(' ');
    return cmd;
}

const cmdList: { name: string, func: (prof: profile.Profile) => Promise<string | undefined> }[] = [
    {
        'name': 'Generate SAS',
        'func': generateSAS
    },
    {
        'name': 'Azcopy',
        'func': azcopy
    }
];

async function quickCmd(prof: profile.Profile) {
    let selected = await vscode.window.showQuickPick(cmdList.map(item => item.name), { title: 'Select a command', ignoreFocusOut: true });
    if (selected === undefined) return;
    let cmd = await cmdList.find(item => item.name === selected)!.func(prof);
    if (cmd === undefined) return;
    let term: vscode.Terminal;
    if (activeTerminal && isAzCliTerminal(activeTerminal) == prof.name) {
        term = activeTerminal;
    } else {
        term = findAzCliTerminal(prof) ||  vscode.window.createTerminal({
            name: `Azure CLI - ${prof.name}`,
            env: {'AZURE_CONFIG_DIR': prof.azureConfigDir},
        });
        term.show();
    }
    term.sendText(cmd, false);
}

function isAzCliTerminal(terminal: vscode.Terminal): string | undefined {
    if (terminal.name.startsWith('Azure CLI - ')) {
        return terminal.name.replace('Azure CLI - ', '');
    }
    return undefined;
}

function findAzCliTerminal(prof: profile.Profile): vscode.Terminal | undefined {
    return vscode.window.terminals.find(term => isAzCliTerminal(term) === prof.name);
}

export function init() {
    outputChannel.appendLine('[INFO] Initializing QuickCmd module...');

    vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.quickCmd', async () => {
        let prof = await profile.selectProfile('Select a profile to run the command');
        if (prof === undefined) return;
        quickCmd(prof);
    }));

    vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.quickCmdFromTerminal', async () => {
        quickCmd(profile.profiles.find(prof => prof.name === isAzCliTerminal(activeTerminal!))!);
    }));

    quickCmdButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    quickCmdButton.command = 'msra_intern_s_toolkit.quickCmdFromTerminal';
    quickCmdButton.text = '$(msra-intern-s-toolkit) QuickCmd';

    vscode.window.onDidChangeActiveTerminal(terminal => { 
        activeTerminal = terminal;

        if (terminal === undefined) {
            quickCmdButton.hide();
            return;
        }

        let prof_name = isAzCliTerminal(terminal);
        if (prof_name === undefined) {
            quickCmdButton.hide();
            return;
        }

        quickCmdButton.show();
    }, null, vscodeContext.subscriptions);
}
