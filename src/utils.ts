import * as vscode from 'vscode';
import * as fs from 'fs'
import * as path from 'path'
import * as cp from 'child_process'
import * as process from 'process'

import { vscodeContext, outputChannel } from './extension'

export function globalPath(file_path: string) {
    return path.join(vscodeContext.extensionPath, file_path)
}

export function workspacePath(file_path: string) {
    if (!vscode.workspace.workspaceFolders) throw new Error('No workspace folder is opened')
    return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.msra_intern_s_toolkit', file_path)
}

export function getFile(file_path: string) {
    let file = globalPath(file_path)
    let data = fs.readFileSync(file, { encoding: 'utf8' })
    return data 
}

export function saveFile(file_path: string, data: any) {
    let dir = file_path.split('/').slice(0, -1).join('/')
    if (!fs.existsSync(globalPath(dir))) fs.mkdirSync(globalPath(dir), {recursive: true})
    let file = globalPath(file_path)
    fs.writeFileSync(file, data, { encoding: 'utf8' })
}

export function exists(path: string) {
    return fs.existsSync(globalPath(path))
}

export function listFiles(dir_path: string) {
    let dir = globalPath(dir_path)
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir, { encoding: 'utf8' }) 
}

export function getWorkspaceFile(file_path: string) {
    let file = workspacePath(file_path)
    let data = fs.readFileSync(file, { encoding: 'utf8' })
    return data
}

export function saveWorkspaceFile(file_path: string, data: any) {
    let dir = file_path.split('/').slice(0, -1).join('/')
    if (!fs.existsSync(workspacePath(dir))) fs.mkdirSync(workspacePath(dir), {recursive: true})
    let file = workspacePath(file_path)
    fs.writeFileSync(file, data, { encoding: 'utf8' })
}

export function workspaceExists(path: string) {
    return fs.existsSync(workspacePath(path))
}

export function listWorkspaceFiles(dir_path: string) {
    let dir = workspacePath(dir_path)
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir, { encoding: 'utf8' })
}

export function showErrorMessageWithHelp(text: string){
    vscode.window.showErrorMessage(text, 'Helps' ,'OK').then((choice) => {
        if (choice == 'Helps'){
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/JeffreyXiang/MSRA-Intern-s-Toolkit#troubleshooting'))
        }
    })
}

export function pidIsRunning(pid: number) {
    try {
        process.kill(pid, 0);
        return true;
    } catch(e) {
        return false;
    }
}

export enum NetProtocol {
    TCP,
    UDP,
    TCPv6,
    UDPv6
}

var winNetProtocolMap = new Map<NetProtocol, string>([
    [NetProtocol.TCP, 'TCP'],
    [NetProtocol.UDP, 'UDP'],
    [NetProtocol.TCPv6, 'TCPv6'],
    [NetProtocol.UDPv6, 'UDPv6']
]);

var macNetProtocolMap = new Map<NetProtocol, string>([
    [NetProtocol.TCP, '4TCP'],
    [NetProtocol.UDP, '4UDP'],
    [NetProtocol.TCPv6, '6TCP'],
    [NetProtocol.UDPv6, '6UDP']
]);

export enum NetState {
    CLOSED,
    LISTEN,
    SYN_SENT,
    SYN_RECV,
    ESTAB,
    FIN_WAIT1,
    FIN_WAIT2,
    TIME_WAIT,
    CLOSING,
    CLOSE_WAIT,
    LAST_ACK
}

var winNetStateMap = new Map<NetState, string>([
    [NetState.CLOSED, 'CLOSED'],
    [NetState.LISTEN, 'LISTENING'],
    [NetState.SYN_SENT, 'SYN_SEND'],
    [NetState.SYN_RECV, 'SYN_RECV'],
    [NetState.ESTAB, 'ESTABLISHED'],
    [NetState.FIN_WAIT1, 'FIN_WAIT1'],
    [NetState.FIN_WAIT2, 'FIN_WAIT2'],
    [NetState.TIME_WAIT, 'TIME_WAIT'],
    [NetState.CLOSING, 'CLOSING'],
    [NetState.CLOSE_WAIT, 'CLOSE_WAIT'],
    [NetState.LAST_ACK, 'LAST_ACK'],
]);

var macNetStateMap = new Map<NetState, string>([
    [NetState.CLOSED, 'CLOSED'],
    [NetState.LISTEN, 'LISTEN'],
    [NetState.SYN_SENT, 'SYN_SENT'],
    [NetState.SYN_RECV, 'SYN_RCVD'],
    [NetState.ESTAB, 'ESTABLISHED'],
    [NetState.FIN_WAIT1, 'FIN_WAIT_1'],
    [NetState.FIN_WAIT2, 'FIN_WAIT_2'],
    [NetState.TIME_WAIT, 'TIME_WAIT'],
    [NetState.CLOSING, 'CLOSING'],
    [NetState.CLOSE_WAIT, 'CLOSE_WAIT'],
    [NetState.LAST_ACK, 'LAST_ACK'],
]);

export async function findNetProcessWin(params: {
    proto?: NetProtocol,
    localAddr?: string,
    localPort?: number,
    foreignAddr?: string,
    foreignPort?: number,
    state?: NetState,
    imageName?: string
}): Promise<number[]> {
    try {
        let pids: Array<number> = [];
        // use 'netstat' cmd to find process with certain connection
        let cmd = `netstat -ano`;
        cmd += (params.proto == undefined)? '' : `p ${winNetProtocolMap.get(params.proto)}`;
        cmd += '|findstr /R /C:".* ';
        cmd += (params.localAddr == undefined)? '[0-9.]*' : `${params.localAddr}`;
        cmd += ':';
        cmd += (params.localPort == undefined)? '[0-9]*' : `${params.localPort}`;
        cmd += ' .* ';
        cmd += (params.foreignAddr == undefined)? '[0-9.]*' : `${params.foreignAddr}`;
        cmd += ':';
        cmd += (params.foreignPort == undefined)? '[0-9]*' : `${params.foreignPort}`;
        cmd += ' .* ';
        cmd += (params.state == undefined)? '.*' : `${winNetStateMap.get(params.state)}`;
        cmd += '"'
        // console.log(`msra_intern_s_toolkit.findNetProcess: Exec ${cmd}`);
        let cmdRes = cp.execSync(cmd).toString().trim().split('\n');
        // console.log(`msra_intern_s_toolkit.findNetProcess: Get ${cmdRes}`);
        let cmdPids = [];
        for (let i = 0; i < cmdRes.length; i++) {
            let pid = parseInt(cmdRes[i].trim().split(/\s+/).pop()!);
            if (cmdPids.indexOf(pid) == -1) cmdPids.push(pid);
        }
        // console.log(`msra_intern_s_toolkit.findNetProcess: Found by net ${cmdPids}`);
        if (params.imageName != undefined) {
            // use 'tasklist' cmd to find process with image name
            let tasklistCmd = `tasklist /FI "IMAGENAME eq ${params.imageName}"|findstr /R "[0-9]"`;
            // console.log(`msra_intern_s_toolkit.findNetProcess: Exec ${tasklistCmd}`);
            let tasklistCmdRes = cp.execSync(tasklistCmd).toString().trim().split('\n');
            // console.log(`msra_intern_s_toolkit.findNetProcess: Get ${tasklistCmdRes}`);
            for (let i = 0; i < tasklistCmdRes.length; i++) {
                let pid = parseInt(tasklistCmdRes[i].trim().split(/\s+/)[1]);
                if (cmdPids.indexOf(pid) != -1 && pids.indexOf(pid) == -1) pids.push(pid);
            }
            // console.log(`msra_intern_s_toolkit.findNetProcess: Found by image name ${pids}`);
        }
        else {
            pids = cmdPids;
        }
        return pids;
    }
    catch (error) {
        // console.log(`msra_intern_s_toolkit.findNetProcess: Not found.`);
        return [];
    }
}

export async function findNetProcessMac(params: {
    proto?: NetProtocol,
    localAddr?: string,
    localPort?: number,
    foreignAddr?: string,
    foreignPort?: number,
    state?: NetState,
    imageName?: string
}): Promise<number[]> {
    try {
        let pids: Array<number> = [];
        // use 'lsof' cmd to find process with certain connection
        let cmd = `lsof -anP -i`;
        cmd += (params.proto == undefined)? '' : macNetProtocolMap.get(params.proto);
        cmd += (params.state == undefined)? '' : ` -sTCP:${macNetStateMap.get(params.state)}`;
        cmd += (params.imageName == undefined)? '' : ` -c${params.imageName}`;
        cmd += '|grep "';
        if (params.localAddr != undefined || params.localPort != undefined) {
            cmd += (params.localAddr == undefined)? ' [0-9.]*' : ` ${params.localAddr}`;
            cmd += ':';
            cmd += (params.localPort == undefined)? '[0-9]*' : `${params.localPort}`;
        }
        if (params.foreignAddr != undefined || params.foreignPort != undefined) {
            cmd += '->';
            cmd += (params.foreignAddr == undefined)? '[0-9.]*' : `${params.foreignAddr}`;
            cmd += ':';
            cmd += (params.foreignPort == undefined)? '[0-9]* ' : `${params.foreignPort} `;
        }
        cmd += '"';

        // console.log(`msra_intern_s_toolkit.findNetProcess: Exec ${lsofCmd}`);
        let cmdRes = cp.execSync(cmd).toString().trim().split('\n');
        // console.log(`msra_intern_s_toolkit.findNetProcess: Get ${cmdRes}`);
        for (let i = 0; i < cmdRes.length; i++) {
            let pid = parseInt(cmdRes[i].trim().split(/\s+/)[1]);
            if (pids.indexOf(pid) == -1) pids.push(pid);
        }
        return pids;
    }
    catch (error) {
        // console.log(`msra_intern_s_toolkit.findNetProcess: Not found.`);
        return [];
    }
}
