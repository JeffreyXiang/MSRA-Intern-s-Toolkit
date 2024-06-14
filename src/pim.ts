import * as vscode from 'vscode';
import {vscodeContext, outputChannel} from './extension'
import {showErrorMessageWithHelp, mapToObj, objToMap} from './utils'
import {getFile, saveFile, exists} from './helper/file_utils'
import * as azure from './helper/azure'
import * as account from './account'
import { PIMView } from './ui/pim';
import exp = require('constants');

export var ui: PIMView;

var roles: azure.pim.Role[];
var autoActivationEnabled: Map<string, boolean> = new Map();
var planedTasks: Map<string, NodeJS.Timeout> = new Map();

function addPlanedTask(role: azure.pim.Role, planedTime: Date) {
    planedTasks.set(role.name, setTimeout(async () => {
        let response: any;
        try {
            response = await azure.pim.getRoleAssignment(role);
        } catch (error) {
            if (error === 'role_assignment_not_found') {
                if (autoActivationEnabled.get(role.name)) {
                    // Expired, activate again
                    ui.update(role.name, 'deactivated');
                    await activate(role.name);
                }
                else {
                    ui.update(role.name, 'deactivated');
                }
            }
            else {
                ui.update(role.name, 'deactivated');
                showErrorMessageWithHelp(`Failed to get role assignment: ${error}`);
            }
            return;
        }
        // Not expired yet, plan another task after 1 minutes
        addPlanedTask(role, new Date(planedTime.getTime() + 60000));
    }, planedTime.getTime() - Date.now()));
    console.log(planedTasks);
}

export class uiParams {
    roles?: azure.pim.Role[];
    autoActivationEnabled?: Map<string, boolean>;
}

export async function refreshUI() {
    ui.setContent({roles: roles, autoActivationEnabled: mapToObj(autoActivationEnabled)});
}

export async function activate(name: string) {
    let role = roles.find(role => role.name === name)!;
    if (role === undefined) return;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Activating ${role.displayName} of ${role.resourceName}...`,
        cancellable: false
    }, async () => {
        let response: any;
        try {
            await azure.pim.activateRole(role);
        } catch (error) {
            showErrorMessageWithHelp(`Failed to activate role: ${error}`);
            ui.update(role.name, 'deactivated');
            throw 'failed_to_activate_role'
        }
        ui.update(role.name, 'validating');
        while (true) {
            try {
                await new Promise(resolve => setTimeout(resolve, 5000));
                response = await azure.pim.getRoleAssignment(role);
                if (response.properties.assignmentType === 'Activated') break;
            } catch (error) {}
        }
        role.assignmentName = response.name;
        role.assignmentType = response.properties.assignmentType;
        role.startDateTime = response.properties.startDateTime;
        role.endDateTime = response.properties.endDateTime;
        addPlanedTask(role, new Date(role.endDateTime!));
        vscode.window.showInformationMessage('Role activated successfully');
        ui.update(role.name, 'activated');
    });
}

export async function deactivate(name: string) {
    let role = roles.find(role => role.name === name)!;
    if (role === undefined) return;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Deactivating ${role.displayName} of ${role.resourceName}...`,
        cancellable: false
    }, async () => {
        try {
            await azure.pim.deactivateRole(role);
        } catch (error) {
            showErrorMessageWithHelp(`Failed to deactivate role: ${error}`);
            ui.update(role.name, 'activated');
            throw 'failed_to_deactivate_role'
        }
        delete role.assignmentName;
        delete role.assignmentType;
        delete role.startDateTime;
        delete role.endDateTime;
        if (planedTasks.has(role.name)) {
            clearTimeout(planedTasks.get(role.name)!);
            planedTasks.delete(role.name);
        }
        vscode.window.showInformationMessage('Role deactivated successfully');
        ui.update(role.name, 'deactivated');
    });
}

export async function enableAutoActivation(name: string) {
    let role = roles.find(role => role.name === name)!;
    if (role === undefined) return;
    autoActivationEnabled.set(role.name, true);
    savePIMCache();
}

export async function disableAutoActivation(name: string) {
    let role = roles.find(role => role.name === name)!;
    if (role === undefined) return;
    autoActivationEnabled.set(role.name, false);
    savePIMCache();
}

function savePIMCache() {
    let cachePath = `./userdata/${account.alias}/pim.json`;
    saveFile(cachePath, JSON.stringify({autoActivationEnabled: mapToObj(autoActivationEnabled)}, null, 4));
}

function loadPIMCache() {
    let cachePath = `./userdata/${account.alias}/pim.json`;
    if (exists(cachePath)) {
        let cache = JSON.parse(getFile(cachePath));
        autoActivationEnabled = objToMap(cache.autoActivationEnabled);
    }
}

export function loggedOut() {
    roles = [];
    autoActivationEnabled = new Map();
    planedTasks.forEach(clearTimeout);
    planedTasks.clear();
    refreshUI();
}

export async function loggedIn() {
    loadPIMCache();
    refreshUI();
}

export function init() {
    outputChannel.appendLine('[INFO] Initializing Privileged Identity Management module...');

    vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.refreshPIMRoles', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Loading PIM roles...',
            cancellable: false
        }, async () => {
            planedTasks.forEach(clearTimeout);
            planedTasks.clear();
            roles = await azure.pim.getRoles();
            let copy = new Map(Array.from(autoActivationEnabled));
            autoActivationEnabled.clear();
            for (let role of roles) {
                autoActivationEnabled.set(role.name, copy.get(role.name) || false);
                if (role.assignmentType === 'Activated') {
                    addPlanedTask(role, new Date(role.endDateTime!));
                }
            }
            savePIMCache();
            refreshUI();
        });
    }));

    ui = new PIMView();
    vscodeContext.subscriptions.push(vscode.window.registerWebviewViewProvider(
        'msra_intern_s_toolkit_view_PIM',
        ui,
        {webviewOptions: {retainContextWhenHidden: true}}
    ));
}
