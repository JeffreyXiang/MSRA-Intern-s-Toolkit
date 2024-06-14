import * as vscode from 'vscode';
import {vscodeContext, outputChannel} from './extension'
import {showErrorMessageWithHelp} from './utils'
import * as azure from './helper/azure'
import { PIMView } from './ui/pim';
import exp = require('constants');

export var ui: PIMView;

var roles: azure.pim.Role[];
var autoActivationEnabled: Map<string, boolean> = new Map();
var planedActivations: Map<string, NodeJS.Timeout> = new Map();

function addPlanedActivation(role: azure.pim.Role, planedTime: Date) {
    planedActivations.set(role.name, setTimeout(async () => {
        let response: any;
        try {
            response = await azure.pim.getRoleAssignment(role);
        } catch (error) {
            if (error === 'role_assignment_not_found') {
                // Expired, activate again
                ui.update(role.name, 'deactivated');
                await activate(role.name);
            }
            else {
                ui.update(role.name, 'deactivated');
                showErrorMessageWithHelp(`Failed to auto activate role: ${error}`);
            }
            return;
        }
        // Not expired yet, plan another activation after 5 minutes
        addPlanedActivation(role, new Date(planedTime.getTime() + 300000));
    }, planedTime.getTime() - Date.now()));
    console.log(planedActivations);
}

export class uiParams {
    roles?: azure.pim.Role[];
    autoActivationEnabled?: Map<string, boolean>;
}

export async function refreshUI() {
    ui.setContent({roles: roles, autoActivationEnabled: autoActivationEnabled});
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
        if (autoActivationEnabled.get(role.name)) {
            addPlanedActivation(role, new Date(role.endDateTime!));
        }
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
        if (planedActivations.has(role.name)) {
            clearTimeout(planedActivations.get(role.name)!);
            planedActivations.delete(role.name);
        }
        vscode.window.showInformationMessage('Role deactivated successfully');
        ui.update(role.name, 'deactivated');
    });
}

export async function enableAutoActivation(name: string) {
    let role = roles.find(role => role.name === name)!;
    if (role === undefined) return;
    autoActivationEnabled.set(role.name, true);
    if (role.assignmentType === 'Activated') {
        addPlanedActivation(role, new Date(role.endDateTime!));
    }
}

export async function disableAutoActivation(name: string) {
    let role = roles.find(role => role.name === name)!;
    if (role === undefined) return;
    autoActivationEnabled.set(role.name, false);
    if (planedActivations.has(role.name)) {
        clearTimeout(planedActivations.get(role.name)!);
        planedActivations.delete(role.name);
    }
}

export function init() {
    outputChannel.appendLine('[INFO] Initializing Privileged Identity Management module...');

    vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.refreshPIMRoles', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Loading PIM roles...',
            cancellable: false
        }, async () => {
            roles = await azure.pim.getRoles();
            for (let role of roles) {
                autoActivationEnabled.set(role.name, false);
            }
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
