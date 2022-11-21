import * as vscode from 'vscode';
import * as fs from 'fs'
import * as path from 'path'
import * as cp from 'child_process'

import { vscodeContext } from './extension'

export function globalPath(file_path: string) {
    return path.join(vscodeContext.extensionPath, file_path)
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

export async function findNetProcess(params: {
    proto?: string,
    localAddr?: string,
    localPort?: number,
    foreignAddr?: string,
    foreignPort?: number,
    state?: string,
    imageName?: string
}): Promise<number[]> {
    try {
        let pids: Array<number> = [];
        // use 'netstat' cmd to find process with certain connection
        let netstatCmd = `netstat -ano|findstr /R /C:"`;
        netstatCmd += (params.proto == undefined)? '[A-Z]*' : `${params.proto}`;
        netstatCmd += ' .* ';
        netstatCmd += (params.localAddr == undefined)? '[0-9.]*' : `${params.localAddr}`;
        netstatCmd += ':';
        netstatCmd += (params.localPort == undefined)? '[0-9]*' : `${params.localPort}`;
        netstatCmd += ' .* ';
        netstatCmd += (params.foreignAddr == undefined)? '[0-9.]*' : `${params.foreignAddr}`;
        netstatCmd += ':';
        netstatCmd += (params.foreignPort == undefined)? '[0-9]*' : `${params.foreignPort}`;
        netstatCmd += ' .* ';
        netstatCmd += (params.state == undefined)? '.*' : `${params.state}`;
        netstatCmd += '"'
        // console.log(`msra_intern_s_toolkit.findNetProcess: Exec ${netstatCmd}`);
        let netstatCmdRes = cp.execSync(netstatCmd).toString().trim().split('\n');
        // console.log(`msra_intern_s_toolkit.findNetProcess: Get ${netstatCmdRes}`);
        let netstatPids = [];
        for (let i = 0; i < netstatCmdRes.length; i++) {
            let pid = parseInt(netstatCmdRes[i].trim().split(/\s+/).pop()!);
            if (netstatPids.indexOf(pid) == -1) netstatPids.push(pid);
        }
        // console.log(`msra_intern_s_toolkit.findNetProcess: Found by net ${netstatPids}`);
        if (params.imageName != undefined) {
            // use 'tasklist' cmd to find process with image name
            let tasklistCmd = `tasklist /FI "IMAGENAME eq ${params.imageName}"|findstr /R "[0-9]"`;
            // console.log(`msra_intern_s_toolkit.findNetProcess: Exec ${tasklistCmd}`);
            let tasklistCmdRes = cp.execSync(tasklistCmd).toString().trim().split('\n');
            // console.log(`msra_intern_s_toolkit.findNetProcess: Get ${tasklistCmdRes}`);
            for (let i = 0; i < tasklistCmdRes.length; i++) {
                let pid = parseInt(tasklistCmdRes[i].trim().split(/\s+/)[1]);
                if (netstatPids.indexOf(pid) != -1 && pids.indexOf(pid) == -1) pids.push(pid);
            }
            // console.log(`msra_intern_s_toolkit.findNetProcess: Found by image name ${pids}`);
        }
        else {
            pids = netstatPids;
        }
        return pids;
    }
    catch (error) {
        // console.log(`msra_intern_s_toolkit.findNetProcess: Not found.`);
        return [];
    }
}
