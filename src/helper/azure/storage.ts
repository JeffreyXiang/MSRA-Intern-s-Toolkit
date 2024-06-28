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

    static fromJSON(obj: any): StorageAccount {
        let newAccount = new StorageAccount(obj.name, obj.uri);
        if (obj.id) newAccount.id = obj.id;
        if (obj.subscription) newAccount.subscription = obj.subscription;
        if (obj.resourceGroup) newAccount.resourceGroup = obj.resourceGroup;
        if (obj.key) newAccount.key = obj.key;
        return newAccount;
    }

    static fromSubscription(id: string, name: string, subscription: string, resourceGroup: string, uri: string): StorageAccount {
        let newAccount = new StorageAccount(name, uri);
        newAccount.id = id;
        newAccount.subscription = subscription;
        newAccount.resourceGroup = resourceGroup;
        return newAccount;
    }

    static fromKey(name: string, key: string): StorageAccount {
        let newAccount = new StorageAccount(name, `https://${name}.blob.core.windows.net/`);
        newAccount.key = key;
        return newAccount;
    }

    getContainers(configDir?: string): Promise<BlobContainer[]> {
        return getContainers(this, configDir);
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
        this.uri = `${storageAccount.uri}${name}`;
    }

    static fromJSON(obj: any): BlobContainer {
        let newContainer = new BlobContainer(
            StorageAccount.fromJSON(obj.storageAccount),
            obj.name
        );
        if (obj.sas) newContainer.sas = SharedAccessSignature.fromJSON(obj.sas);
        newContainer.uri = obj.uri;
        return newContainer;
    }

    async generateSAS(durationDays: number = 7, permissions: string = 'acdlrw', configDir?: string): Promise<SharedAccessSignature> {
        return await generateSAS(this, durationDays, permissions, configDir);
    }

    async getSAS(renew_if_expired_within_days: number = 3, configDir?: string): Promise<SharedAccessSignature> {
        let date = new Date();
        date.setDate(date.getDate() + renew_if_expired_within_days);
        if (this.sas && this.sas.expiry > date) {
            return this.sas;
        }
        this.sas = await this.generateSAS(7, 'acdlrw', configDir);
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

    static fromJSON(obj: any): SharedAccessSignature {
        return new SharedAccessSignature(obj.token, new Date(obj.expiry));
    }
}

export async function getAccounts(subscriptionId: string, configDir?: string): Promise<StorageAccount[]> {
    outputChannel.appendLine(`[CMD] > az storage account list --subscription ${subscriptionId}`);
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise((resolve, reject) => {
        cp.exec(`az storage account list --subscription ${subscriptionId}`, {env: env}, (error, stdout, stderr) => {
            if (stdout) {
                outputChannel.appendLine('[CMD OUT] ' + stdout);
                let accounts: StorageAccount[] = [];
                JSON.parse(stdout).forEach((element: any) => {
                    accounts.push(StorageAccount.fromSubscription(element.id, element.name, subscriptionId, element.resourceGroup, element.primaryEndpoints.blob));
                });
                resolve(accounts);
            }
            if (stderr) {
                outputChannel.appendLine('[CMD ERR] ' + stderr);
                console.error(`msra_intern_s_toolkit.getAccounts: stderr - ${stderr}`);
                reject('failed_to_get_accounts');
            }
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                console.error(`msra_intern_s_toolkit.getAccounts: error - ${error.message}`);
                reject('failed_to_get_accounts');
            }
        });
    });
}

export async function getContainers(account: StorageAccount, configDir?: string): Promise<BlobContainer[]> {
    let cmd: string;
    if (account.key) {
        cmd = `az storage container list --account-name ${account.name} --account-key ${account.key} --auth-mode key`;
    }
    else if (account.subscription) {
        cmd = `az storage container list --account-name ${account.name} --subscription ${account.subscription} --auth-mode login`;
    }
    else {
        throw 'invalid_storage_account';
    }
    outputChannel.appendLine(`[CMD] > ${cmd}`);
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise((resolve, reject) => {
        cp.exec(cmd, {env: env}, (error, stdout, stderr) => {
            if (stdout) {
                outputChannel.appendLine('[CMD OUT] ' + stdout);
                let containers: BlobContainer[] = [];
                JSON.parse(stdout).forEach((element: any) => {
                    containers.push(new BlobContainer(account, element.name));
                });
                resolve(containers);
            }
            if (stderr) {
                outputChannel.appendLine('[CMD ERR] ' + stderr);
                console.error(`msra_intern_s_toolkit.getContainers: stderr - ${stderr}`);
                reject('failed_to_get_containers');
            }
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                console.error(`msra_intern_s_toolkit.getContainers: error - ${error.message}`);
                reject('failed_to_get_containers');
            }
        });
    });
}

export async function generateSAS(container: BlobContainer, durationDays: number = 7, permissions: string = 'acdlrw', configDir?: string): Promise<SharedAccessSignature> {
    let expiry = new Date();
    expiry.setDate(expiry.getDate() + durationDays);
    let expiryStr = expiry.toISOString().split('.')[0] + 'Z';
    let cmd: string;
    if (container.storageAccount.key) {
        cmd = `az storage container generate-sas --account-name ${container.storageAccount.name} --account-key ${container.storageAccount.key} --name ${container.name} --auth-mode key --expiry ${expiryStr} --permissions ${permissions}`;
    }
    else if (container.storageAccount.subscription) {
        cmd = `az storage container generate-sas --account-name ${container.storageAccount.name} --name ${container.name} --as-user --auth-mode login --expiry ${expiryStr} --permissions ${permissions} --https-only --subscription ${container.storageAccount.subscription}`;
    }
    else {
        throw 'invalid_storage_account';
    }
    outputChannel.appendLine(`[CMD] > ${cmd}`);
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise((resolve, reject) => {
        cp.exec(cmd, {env: env}, (error, stdout, stderr) => {
            if (stdout) {
                outputChannel.appendLine('[CMD OUT] ' + stdout);
                resolve(new SharedAccessSignature(stdout.trim().slice(1, -1), expiry));
            }
            if (stderr) {
                outputChannel.appendLine('[CMD ERR] ' + stderr);
                console.error(`msra_intern_s_toolkit.generateSAS: stderr - ${stderr}`);
                reject('failed_to_generate_sas');
            }
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                console.error(`msra_intern_s_toolkit.generateSAS: error - ${error.message}`);
                reject('failed_to_generate_sas');
            }
        });
    });
}

export async function upload(localPath: string, remotePath: string, container: BlobContainer, kwargs?: {recursive?: boolean, excludePath?: string, excludePattern?: string, includePath?: string, includePattern?: string}, progress?: (increment: number) => void, configDir?: string): Promise<void> {
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
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise<void>((resolve, reject) => {
        let proc = cp.spawn('az', args, {shell: true, env: env});
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
