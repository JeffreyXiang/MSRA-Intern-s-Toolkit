import * as vscode from 'vscode';
import * as cp from 'child_process'
import * as process from 'process'
import {vscodeContext, outputChannel} from './extension'
import * as az from './azure';
import {globalPath, pidIsRunning, findNetProcessWin, findNetProcessMac, NetProtocol, NetState, getFile, saveFile, exists, showErrorMessageWithHelp} from './utils'
import {GCRTunnelView} from './ui/gcr_tunnel'

var supportedOS = ['win32', 'darwin'];

/* Bastion Tunnel */

class TunnelSetting {
    sandboxID: number;
	port: number;

    constructor(sandboxID: number, port: number) {
		this.sandboxID = sandboxID;
		this.port = port;
	}
}

export class Tunnel {
	state: string = 'unknown'; // unknown closed preopen_check bastion_opening bastion_opening_failed bastion_opened ssh_opening ssh_opening_failed opened closing
	sandboxID: number;
	port: number;
	sshPort: number;
	procID?: number;
	sshProcID?: number;
    retried: number = 0;

	constructor(setting: TunnelSetting) {
		this.sandboxID = setting.sandboxID;
		this.port = setting.port - 20000;
		this.sshPort = setting.port;
	}

    getSetting(): TunnelSetting {
        return {sandboxID: this.sandboxID, port: this.sshPort};
    }
}

var tunnels: Array<Tunnel>;

var ui: GCRTunnelView | undefined = undefined;

export async function addTunnel() {
    // input sandbox ID
    let res = await vscode.window.showInputBox({
        title: 'Input sandbox ID',
        prompt: 'Sandbox ID is the last 4 digits of the GCRAZGDL#### host you wish to connect to.'
    });
    if (res != undefined) {
        // sandbox ID check
        if (res.length != 4) {
            vscode.window.showErrorMessage('Invalid sandbox ID.');
            return;
        } 
        if (!Array.from(res).every((v) => ('0123456789'.includes(v)))) {
            vscode.window.showErrorMessage('Invalid sandbox ID.');
            return;
        }
        let sandboxID = parseInt(res);

        // find default port
        let occupiedPorts = Array(tunnels.length).fill(0).map((_, i) => tunnels[i].sshPort);
        let defaultPort = 22222;
        while (occupiedPorts.includes(defaultPort)) {defaultPort++;}

        // input port
        res = await vscode.window.showInputBox({
            title: 'Input port',
            value: `${defaultPort}`,
            prompt: 'Local port of the tunnel, should be 5 digits start with 2.'
        });
        if (res != undefined) {
            // port check
            if (res.length != 5) {
                vscode.window.showErrorMessage('Invalid port.');
                return;
            } 
            if (!Array.from(res).every((v, i) => (i == 0 ? v == '2' : '0123456789'.includes(v)))) {
                vscode.window.showErrorMessage('Invalid port.');
                return;
            }
            let port = parseInt(res);
            if (occupiedPorts.includes(port)) {
                vscode.window.showErrorMessage('Port already occupied.');
                return;
            }

            let setting: TunnelSetting = {sandboxID: sandboxID, port: port};
            tunnels.push(new Tunnel(setting));
            console.log(`msra_intern_s_toolkit: Tunnel${tunnels.length - 1} added - ${JSON.stringify(setting)}`);
            refresh();
        }
    }
}

export async function deleteTunnel(i?: number) {
    if (i == undefined) {
        let res = await vscode.window.showQuickPick(Array(tunnels.length).fill(null).map((_, i) => `${i}(GCRAZGDL${tunnels[i].sandboxID} | 127.0.0.1:${tunnels[i].sshPort})`), {
            title: 'Select tunnel index',
            canPickMany: false,
            ignoreFocusOut: true
        });
        if (res == undefined) return;
        i = parseInt(res);
    }
    let confirm = await vscode.window.showQuickPick(['yes', 'no'], {
        title: `Deleting GCR tunnel${i}(GCRAZGDL${tunnels[i].sandboxID} | 127.0.0.1:${tunnels[i].sshPort}), confirm?`,
        canPickMany: false,
        ignoreFocusOut: true
    });
    if (confirm == 'yes') {
        if (tunnels[i].state != 'closed') {
            vscode.window.showErrorMessage(`Failed to delete GCR tunnel${i}. Close the tunnel before delete.`);
        }
        else {
            console.log(`msra_intern_s_toolkit: Tunnel${tunnels.length - 1} deleted - ${JSON.stringify(tunnels[i].getSetting())}`);
            tunnels.splice(i, 1);
            refresh();
        }
    }
}

export async function openTunnel(i?: number) {
    if (i == undefined) {
        let res = await vscode.window.showQuickPick(Array(tunnels.length).fill(null).map((_, i) => `${i}(GCRAZGDL${tunnels[i].sandboxID} | 127.0.0.1:${tunnels[i].sshPort})`).filter((_, i) => (tunnels[i].state == 'closed')), {
            title: 'Select tunnel index',
            canPickMany: false,
            ignoreFocusOut: true
        });
        if (res == undefined) return;
        i = parseInt(res);
    }
    if (tunnels[i].state == 'closed' && i != undefined) {
        tunnels[i].state = 'preopen_check';
        update(i);
    }
}

function reconnectTunnel(i: number, maxTrials: number) {
    if (tunnels[i].retried < maxTrials) {
        tunnels[i].retried++;
        openTunnel(i);
    }
    else {
        tunnels[i].retried = 0;
        vscode.window.showErrorMessage(`Unable to reconnect GCR tunnel${i}. Check your network and try again.`);
    }
}

function openBastionTunnel(i: number) {
    tunnels[i].state = 'bastion_opening';
    update(i);
    let proc : cp.ChildProcessWithoutNullStreams;
    switch (process.platform) {
        case 'win32':
            console.log(`msra_intern_s_toolkit.openTunnel: Exec pwsh.exe ${globalPath('script/gcr_tunnel/gdl.ps1')} -tunnel -num ${tunnels[i].sandboxID} -alias ${`${az.domain}.${az.alias}`} -port ${tunnels[i].port}`);
            outputChannel.appendLine(`[CMD] > pwsh.exe ${globalPath('script/gcr_tunnel/gdl.ps1')} -tunnel -num ${tunnels[i].sandboxID} -alias ${`${az.domain}.${az.alias}`} -port ${tunnels[i].port}`);
            proc = cp.spawn('pwsh.exe', [globalPath('script/gcr_tunnel/gdl.ps1'), '-tunnel', '-num', `${tunnels[i].sandboxID}`, '-alias', `${az.domain}.${az.alias}`, '-port', `${tunnels[i].port}`]);
            break;
        case 'darwin':
            console.log(`msra_intern_s_toolkit.openTunnel: Exec bash ${globalPath('script/gcr_tunnel/gdl.sh')} -t -n ${tunnels[i].sandboxID} -a ${`${az.domain}.${az.alias}`} -p ${tunnels[i].port}`);
            outputChannel.appendLine(`[CMD] > bash ${globalPath('script/gcr_tunnel/gdl.sh')} -t -n ${tunnels[i].sandboxID} -a ${`${az.domain}.${az.alias}`} -p ${tunnels[i].port}`);
            proc = cp.spawn('bash', [globalPath('script/gcr_tunnel/gdl.sh'), '-t', '-n', `${tunnels[i].sandboxID}`, '-a', `${az.domain}.${az.alias}`, '-p', `${tunnels[i].port}`]);
            break;
        default:
            showErrorMessageWithHelp(`Failed to open GCR tunnel${i}. Platform not supported.`);
            tunnels[i].state = 'bastion_opening_failed';
            return;
    }
    let timeout = setTimeout(((i) => () => {
        proc.kill();
        showErrorMessageWithHelp(`Failed to open GCR tunnel${i}. Command timeout.`);
        tunnels[i].state = 'bastion_opening_failed';
        update(i);
    })(i), 60000);
    proc.on('error', ((i) => (err) => {
        proc.kill();
        clearTimeout(timeout);
        showErrorMessageWithHelp(`Failed to open GCR tunnel${i}. Powershell spawning failed.`);
        tunnels[i].state = 'bastion_opening_failed';
        update(i);
    })(i))
    proc.stdout.on('data', (data) => {
        outputChannel.appendLine('[CMD OUT] ' + data);
        console.log(`msra_intern_s_toolkit.openTunnel: ${data}`);
    });
    proc.stderr.on('data', ((i) => (data) => {
        let sdata = String(data);
        outputChannel.appendLine('[CMD ERR] ' + sdata);
        console.error(`msra_intern_s_toolkit.openTunnel: ${sdata}`);
        if (sdata.includes('SecurityError')) {
            proc.kill();
            clearTimeout(timeout);
            showErrorMessageWithHelp(`Failed to open GCR tunnel${i}. Powershell script forbidden.`);
            tunnels[i].state = 'bastion_opening_failed';
            update(i);
        }
        else if (sdata.includes('Tunnel is ready')) {
            proc.kill();
            clearTimeout(timeout);
        }
    })(i));
    proc.on('exit', ((i) => (code) => {
        clearTimeout(timeout);
        // console.log(`msra_intern_s_toolkit.openTunnel: Process exited with ${code}`);
        if (code) {
            switch (code) {
                case 2:
                    showErrorMessageWithHelp(`Failed to open GCR tunnel${i}. Azure CLI not installed.`);
                    break;
                case 3:
                    showErrorMessageWithHelp(`Failed to open GCR tunnel${i}. az ssh extension not installed.`);
                    break;
                case 4:
                    showErrorMessageWithHelp(`Failed to open GCR tunnel${i}. Keypath not found.`);
                    break;
                default:
                    showErrorMessageWithHelp(`Failed to open GCR tunnel${i}. code ${code}`);
            }
            tunnels[i].state = 'bastion_opening_failed';
            update(i);
        }
    })(i));
}

function openSSHTunnel(i: number) {
    tunnels[i].state = 'ssh_opening';
    update(i);
    let ignoreHostFile = process.platform == 'win32' ? '\\\\.\\NUL' : '/dev/null';
    console.log(`msra_intern_s_toolkit.openTunnel: Exec ssh -N -L ${tunnels[i].sshPort}:127.0.0.1:22 ${`${az.domain}.${az.alias}`}@127.0.0.1 -p ${tunnels[i].port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=${ignoreHostFile}`);
    outputChannel.appendLine(`[CMD] > ssh -N -L ${tunnels[i].sshPort}:127.0.0.1:22 ${`${az.domain}.${az.alias}`}@127.0.0.1 -p ${tunnels[i].port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=${ignoreHostFile}`);
    let proc = cp.spawn('ssh', ['-N', '-L', `${tunnels[i].sshPort}:127.0.0.1:22`, `${`${az.domain}.${az.alias}`}@127.0.0.1`, '-p', `${tunnels[i].port}`, '-o', 'StrictHostKeyChecking=no', '-o', `UserKnownHostsFile=${ignoreHostFile}`], {detached: true, stdio: 'ignore'});
    proc.unref();
    proc.on('exit', (code) => {
        if (tunnels[i].state == 'ssh_opening') {
            showErrorMessageWithHelp(`Failed to open GCR tunnel${i}. SSH tunnel failed.`);
            // console.log(`msra_intern_s_toolkit.openTunnel: Process exited with ${code}`);
            tunnels[i].state = 'ssh_opening_failed'
            process.kill(tunnels[i].procID!);
            update(i);
        }
    });
}

export async function closeTunnel(i?: number) {
    if (i == undefined) {
        let res = await vscode.window.showQuickPick(Array(tunnels.length).fill(null).map((_, i) => `${i}(GCRAZGDL${tunnels[i].sandboxID} | 127.0.0.1:${tunnels[i].sshPort})`).filter((_, i) => (tunnels[i].state == 'opened')), {
            title: 'Select tunnel index',
            canPickMany: false,
            ignoreFocusOut: true
        });
        if (res == undefined) return;
        i = parseInt(res);
    }
    if (tunnels[i].state == 'opened') {
        process.kill(tunnels[i].sshProcID!);
        process.kill(tunnels[i].procID!);
        tunnels[i].state = 'closing';
        update(i);
    }
}

function polling(){
    for (let i = 0; i < tunnels.length; i++) {
        // Separatel deal with 'closed' and 'opened' state for better performance.
        if (tunnels[i].state == 'closed') { }
        else if (tunnels[i].state == 'opened') {
            let bastionExists = pidIsRunning(tunnels[i].procID!);
            let sshExists = pidIsRunning(tunnels[i].sshProcID!);
            let reconectionEnabled = vscode.workspace.getConfiguration('msra_intern_s_toolkit.gcrTunnel.autoReconnection').get<boolean>('enabled');
            let maxTrials = vscode.workspace.getConfiguration('msra_intern_s_toolkit.gcrTunnel.autoReconnection').get<number>('maxTrials') ?? 0;

            if (!sshExists) {
                if (bastionExists) process.kill(tunnels[i].procID!);
                tunnels[i].state = 'closed';
                update(i);
                if (reconectionEnabled) {
                    vscode.window.showInformationMessage(`GCR tunnel${i} accidentally closed. Reconnecting...`);
                    reconnectTunnel(i, maxTrials);
                } else {
                    vscode.window.showErrorMessage(`GCR tunnel${i} accidentally closed. Reopen?`, 'Yes', 'No').then((choice) => {
                        if (choice == 'Yes') {
                            openTunnel(i);
                        }
                    });
                    vscode.window.showInformationMessage(`GCR tunnel auto reconnection can be enabled in settings.`);
                }
            }
        }
        else {
            Promise.all(process.platform == 'win32' ? [
                // find bastion process
                findNetProcessWin({
                    proto: NetProtocol.TCP,
                    localAddr: '127.0.0.1',
                    localPort: tunnels[i].port,
                    state: NetState.LISTEN,
                    imageName: 'python.exe'
                }),
                // find ssh process
                findNetProcessWin({
                    proto: NetProtocol.TCP,
                    localAddr: '127.0.0.1',
                    localPort: tunnels[i].sshPort,
                    state: NetState.LISTEN,
                    imageName: 'ssh.exe'
                })
            ] : [
                // find bastion process
                findNetProcessMac({
                    proto: NetProtocol.TCP,
                    localAddr: '127.0.0.1',
                    localPort: tunnels[i].port,
                    state: NetState.LISTEN,
                    imageName: 'Python'
                }),
                // find ssh process
                findNetProcessMac({
                    proto: NetProtocol.TCP,
                    localAddr: '127.0.0.1',
                    localPort: tunnels[i].port,
                    state: NetState.LISTEN,
                    imageName: 'ssh'
                })
            ]).then((pids) => {
                let bastionExists = (pids[0].length != 0);
                let sshExists = (pids[1].length != 0);
                let bastionPID = pids[0][0];
                let sshPID = pids[1][0];
                let maxTrials = vscode.workspace.getConfiguration('msra_intern_s_toolkit.gcrTunnel.autoReconnection').get<number>('maxTrials') ?? 0;

                tunnels[i].procID = bastionPID;
                tunnels[i].sshProcID = sshPID;
                
                // unknown closed preopen_check bastion_opening bastion_opening_failed bastion_opened ssh_opening ssh_opening_failed opened closing
                if (tunnels[i].state == 'unknown') {
                    if (!bastionExists && !sshExists) tunnels[i].state = 'closed';
                    else if (bastionExists && !sshExists) {
                        process.kill(bastionPID);
                        tunnels[i].state = 'closed';
                    }
                    else if (bastionExists && sshExists) {
                        tunnels[i].state = 'opened';
                        tunnels[i].retried = 0;
                        vscode.window.showInformationMessage(`GCR tunnel${i} opened.`);
                    }
                    update(i);
                }
                else if (tunnels[i].state == 'preopen_check') {
                    if (bastionExists && !sshExists) {
                        process.kill(bastionPID);
                        openBastionTunnel(i);
                    }
                    else if (bastionExists && sshExists){
                        tunnels[i].state = 'opened';
                        tunnels[i].retried = 0;
                        vscode.window.showInformationMessage(`GCR tunnel${i} opened.`);
                        update(i);
                    }
                    else {
                        openBastionTunnel(i);
                    }
                }
                else if (tunnels[i].state == 'bastion_opening') {
                    if (bastionExists) {
                        tunnels[i].state = 'bastion_opened';
                        update(i);
                        openSSHTunnel(i);
                    }
                }
                else if (tunnels[i].state == 'bastion_opening_failed') {
                    tunnels[i].state = 'closed';
                    update(i);
                    if (tunnels[i].retried > 0) {   // In retrial
                        reconnectTunnel(i, maxTrials);
                    }
                }
                else if (tunnels[i].state == 'bastion_opened') {
                    openSSHTunnel(i);
                }
                else if (tunnels[i].state == 'ssh_opening') {
                    if (sshExists) {
                        tunnels[i].state = 'opened';
                        tunnels[i].retried = 0;
                        update(i);
                        vscode.window.showInformationMessage(`GCR tunnel${i} opened.`);
                    }
                }
                else if (tunnels[i].state == 'ssh_opening_failed') {
                    tunnels[i].state = 'closed';
                    update(i);
                    if (tunnels[i].retried > 0) {   // In retrial
                        reconnectTunnel(i, maxTrials);
                    }
                }
                else if (tunnels[i].state == 'closing') {
                    tunnels[i].state = 'closed';
                    update(i);
                    vscode.window.showInformationMessage(`GCR tunnel${i} closed.`);
                }
            })
        }
    }
}

function update(i: number) {
    console.log(`msra_intern_s_toolkit: Tunnel${i} - ${JSON.stringify(tunnels[i])}`);
    if (ui != undefined) {
        ui.update(i, tunnels[i]);
    }
}

export function init() {
    outputChannel.appendLine('[INFO] Initializing GCR tunnel module...');
    let isSupported = supportedOS.includes(process.platform);
    outputChannel.appendLine(`[INFO] Platform: ${process.platform}`);

    if (isSupported) {
        vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.addGCRTunnel', () => {addTunnel()}));
        vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.deleteGCRTunnel', () => {deleteTunnel()}));
        vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.openGCRTunnel', () => {openTunnel()}));
        vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.closeGCRTunnel', () => {closeTunnel()}));

        tunnels = exists('./userdata/gcr_tunnel.json') ?
            JSON.parse(getFile('./userdata/gcr_tunnel.json')).map((v: TunnelSetting) => new Tunnel(v)) :
            [];
    }

    ui = new GCRTunnelView();
    vscodeContext.subscriptions.push(vscode.window.registerWebviewViewProvider(
        'msra_intern_s_toolkit_view_GCRTunnel',
        ui,
        {webviewOptions: {retainContextWhenHidden: true}}
    ));

    if (isSupported) {
        setInterval(() => {
            if (az.isLoggedIn) polling();
        }, 1000);
    }
}

export function refreshUI() {
    if (ui != undefined) {
        let isSupported = supportedOS.includes(process.platform);
        if (isSupported) ui.setContent(tunnels);
        else ui.unsupported();
    }
}

function refresh() {
    saveFile('./userdata/gcr_tunnel.json', JSON.stringify(Array(tunnels.length).fill(null).map((_, i) => tunnels[i].getSetting()), null, 4));
    refreshUI();
}
