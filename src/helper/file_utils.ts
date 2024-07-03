import * as vscode from 'vscode';
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { vscodeContext } from '../extension';

export function globalPath(file_path: string) {
    // return path.join(vscodeContext.extensionPath, file_path)
    // This may cause Path length over 260 characters error on Windows
    // Use user path instead (C:\Users\username\.msra_intern_s_toolkit)
    return path.join(os.homedir(), '.msra_intern_s_toolkit', file_path)
}

export function extensionPath(file_path: string) {
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

export function getExtensionFile(file_path: string) {
    let file = extensionPath(file_path)
    let data = fs.readFileSync(file, { encoding: 'utf8' })
    return data
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
