import * as cp from 'child_process'
import {outputChannel} from '../../extension'
import * as account from './account'

export class StorageAccount {
    id?: string;
    name: string;
    subscription?: string;
    resourceGroup?: string;
    key?: string;
    uri: string;
    
    constructor(name: string, uri: string) {
        this.name = name;
        this.uri = uri;
    }

    static fromSubscription(id: string, name: string, subscription: string, resourceGroup: string, uri: string): StorageAccount {
        let newAccount = new StorageAccount(name, uri);
        newAccount.id = id;
        newAccount.subscription = subscription;
        newAccount.resourceGroup = resourceGroup;
        return newAccount;
    }

    static fromKey(name: string, key: string): StorageAccount {
        let newAccount = new StorageAccount(name, `https://${name}.blob.core.windows.net`);
        newAccount.key = key;
        return newAccount;
    }

    getContainers(): Promise<BlobContainer[]> {
        return getContainers(this);
    }
}

export class BlobContainer {
    storageAccount: StorageAccount;
    name: string;
    sas?: SharedAccessSignature;
    uri: string;

    constructor(storageAccount: StorageAccount, name: string) {
        this.storageAccount = storageAccount;
        this.name = name;
        this.uri = `${storageAccount.uri}/${name}`;
    }

    async generateSAS(durationDays: number = 7, permissions: string = 'acdlrw'): Promise<SharedAccessSignature> {
        return await generateSAS(this, durationDays, permissions);
    }

    async getSAS(renew_if_expired_within_days: number = 3): Promise<SharedAccessSignature> {
        let date = new Date();
        date.setDate(date.getDate() + renew_if_expired_within_days);
        if (this.sas && this.sas.expiry > date) {
            return this.sas;
        }
        this.sas = await this.generateSAS();
        return this.sas;
    }
}

export class SharedAccessSignature {
    token: string;
    expiry: Date;

    constructor(token: string, expiry: Date) {
        this.token = token;
        this.expiry = expiry;
    }
}

export async function getAccounts(subscriptionId: string): Promise<StorageAccount[]> {
    outputChannel.appendLine(`[CMD] > az storage account list --subscription ${subscriptionId}`);
    let proc = cp.spawnSync('az', ['storage', 'account', 'list', '--subscription', subscriptionId], {shell: true});
    let stdout = proc.stdout.toString();
    let stderr = proc.stderr.toString();
    if (stdout) {
        outputChannel.appendLine('[CMD OUT] ' + stdout);
        let accounts: StorageAccount[] = [];
        JSON.parse(stdout).forEach((element: any) => {
            accounts.push(StorageAccount.fromSubscription(element.id, element.name, subscriptionId, element.resourceGroup, element.primaryEndpoints.blob));
        });
        return accounts;
    }
    if (stderr) {
        outputChannel.appendLine('[CMD ERR] ' + stderr);
        console.error(`msra_intern_s_toolkit.getAccounts: stderr - ${stderr}`);
    }
    if (proc.error) {
        outputChannel.appendLine('[CMD ERR] ' + proc.error.message);
        console.error(`msra_intern_s_toolkit.getAccounts: error - ${proc.error.message}`);
    }
    throw 'failed_to_get_accounts';
}

export async function getContainers(account: StorageAccount): Promise<BlobContainer[]> {
    let proc: cp.SpawnSyncReturns<Buffer>;
    if (account.key) {
        outputChannel.appendLine(`[CMD] > az storage container list --account-name ${account.name} --account-key ${account.key} --auth-mode key`);
        proc = cp.spawnSync('az', ['storage', 'container', 'list', '--account-name', account.name, '--account-key', account.key, '--auth-mode', 'key'], {shell: true});
    }
    else if (account.subscription) {
        outputChannel.appendLine(`[CMD] > az storage container list --account-name ${account.name} --subscription ${account.subscription} --auth-mode login`);
        proc = cp.spawnSync('az', ['storage', 'container', 'list', '--account-name', account.name, '--subscription', account.subscription, '--auth-mode', 'login'], {shell: true});
    }
    else {
        throw 'invalid_storage_account';
    }
    let stdout = proc.stdout.toString();
    let stderr = proc.stderr.toString();
    if (stdout) {
        outputChannel.appendLine('[CMD OUT] ' + stdout);
        let containers: BlobContainer[] = [];
        JSON.parse(stdout).forEach((element: any) => {
            containers.push(new BlobContainer(account, element.name));
        });
        return containers;
    }
    if (stderr) {
        outputChannel.appendLine('[CMD ERR] ' + stderr);
        console.error(`msra_intern_s_toolkit.getContainers: stderr - ${stderr}`);
    }
    if (proc.error) {
        outputChannel.appendLine('[CMD ERR] ' + proc.error.message);
        console.error(`msra_intern_s_toolkit.getContainers: error - ${proc.error.message}`);
    }
    throw 'failed_to_get_containers';
}

export async function generateSAS(container: BlobContainer, durationDays: number = 7, permissions: string = 'acdlrw'): Promise<SharedAccessSignature> {
    let expiry = new Date();
    expiry.setDate(expiry.getDate() + durationDays);
    let expiryStr = expiry.toISOString().split('.')[0] + 'Z';
    let proc: cp.SpawnSyncReturns<Buffer>;
    if (container.storageAccount.key) {
        outputChannel.appendLine(`[CMD] > az storage container generate-sas --account-name ${container.storageAccount.name} --account-key ${container.storageAccount.key} --name ${container.name} --auth-mode key --expiry ${expiryStr} --permissions ${permissions}`);
        proc = cp.spawnSync('az', ['storage', 'container', 'generate-sas', '--account-name', container.storageAccount.name, '--account-key', container.storageAccount.key, '--name', container.name, '--auth-mode', 'key', '--expiry', expiryStr, '--permissions', permissions], {shell: true});
    }
    else if (container.storageAccount.subscription) {
        outputChannel.appendLine(`[CMD] > az storage container generate-sas --account-name ${container.storageAccount.name} --name ${container.name} --as-user --auth-mode login --expiry ${expiryStr} --permissions ${permissions} --https-only --subscription ${container.storageAccount.subscription}`);
        proc = cp.spawnSync('az', ['storage', 'container', 'generate-sas', '--account-name', container.storageAccount.name, '--name', container.name, '--as-user', '--auth-mode', 'login', '--expiry', expiryStr, '--permissions', permissions, '--https-only', '--subscription', container.storageAccount.subscription], {shell: true});
    }
    else {
        throw 'invalid_storage_account';
    }
    let stdout = proc.stdout.toString();
    let stderr = proc.stderr.toString();
    if (stdout) {
        outputChannel.appendLine('[CMD OUT] ' + stdout);
        return new SharedAccessSignature(stdout.trim().slice(1, -1), expiry);
    }
    if (stderr) {
        outputChannel.appendLine('[CMD ERR] ' + stderr);
        console.error(`msra_intern_s_toolkit.generateSAS: stderr - ${stderr}`);
    }
    if (proc.error) {
        outputChannel.appendLine('[CMD ERR] ' + proc.error.message);
        console.error(`msra_intern_s_toolkit.generateSAS: error - ${proc.error.message}`);
    }
    throw 'failed_to_generate_sas';
}

export async function upload(localPath: string, remotePath: string, container: BlobContainer, kwargs?: {recursive?: boolean, excludePath?: string, excludePattern?: string, includePath?: string, includePattern?: string}, progress?: (increment: number) => void): Promise<void> {
    let args = ['storage', 'copy', '-s', `"${localPath}"`, '-d', `"${container.uri}/${remotePath}"`];
    if (container.storageAccount.key) {
        args.push('--account-key', container.storageAccount.key);
    }
    else if (container.storageAccount.subscription) {
        args.push('--subscription', container.storageAccount.subscription);
    }
    if (kwargs) {
        if (kwargs.recursive) {
            args.push('--recursive');
        }
        if (kwargs.excludePath) {
            if (!kwargs.excludePath.startsWith('\"') && !kwargs.excludePath.endsWith('\"')) {
                kwargs.excludePath = `"${kwargs.excludePath}"`;
            }
            args.push('--exclude-path', kwargs.excludePath);
        }
        if (kwargs.excludePattern) {
            if (!kwargs.excludePattern.startsWith('\"') && !kwargs.excludePattern.endsWith('\"')) {
                kwargs.excludePattern = `"${kwargs.excludePattern}"`;
            }
            args.push('--exclude-pattern', kwargs.excludePattern);
        }
        if (kwargs.includePath) {
            if (!kwargs.includePath.startsWith('\"') && !kwargs.includePath.endsWith('\"')) {
                kwargs.includePath = `"${kwargs.includePath}"`;
            }
            args.push('--include-path', kwargs.includePath);
        }
        if (kwargs.includePattern) {
            if (!kwargs.includePattern.startsWith('\"') && !kwargs.includePattern.endsWith('\"')) {
                kwargs.includePattern = `"${kwargs.includePattern}"`;
            }
            args.push('--include-pattern', kwargs.includePattern);
        }
    }
    outputChannel.appendLine(`[CMD] > az ${args.join(' ')}`);
    return new Promise<void>((resolve, reject) => {
        let proc = cp.spawn('az', args, {shell: true});
        let lastPercent = 0;
        proc.stdout.on('data', (data) => {
            let sdata = String(data);
            outputChannel.append('[CMD OUT] ' + sdata);
            if (/[0-9.]+\s%,\s[0-9]+\sDone,\s[0-9]+\sFailed,\s[0-9]+\sPending,\s[0-9]+\sSkipped,\s[0-9]+\sTotal,\s2-sec\sThroughput\s\(Mb\/s\):\s[0-9.]+/g.test(sdata)) {
                let percent = Number(sdata.split('%')[0]);
                if (progress) { progress(percent - lastPercent); }
                lastPercent = percent;
            }
        });
        proc.stderr.on('data', (data) => {
            let sdata = String(data);
            outputChannel.append('[CMD ERR] ' + sdata);
            if (sdata.includes('Permission denied')) {
                proc.kill();
                reject('permission_denied');
            }
        });
        proc.on('exit', (code) => {
            if (code == 0) {
                resolve();
            } else if (code != null) {
                reject(code);
            }
            else {
                reject('unknown_error');
            }
        });
    });
}
