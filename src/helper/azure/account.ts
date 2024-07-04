import * as cp from 'child_process'
import {outputChannel} from '../../extension'
import {parseJson} from './utils'

export class Subscription {
    id: string;
    name: string;
    
    constructor(id: string, name: string) {
        this.id = id;
        this.name = name;
    }
}

export async function login(deviceCodeCallback?: (authcode: string) => any, configDir?: string): Promise<any> {
    let args = ['login'];
    if (deviceCodeCallback) {
        args.push('--use-device-code');
    }
    outputChannel.appendLine(`[CMD] > az ${args.join(' ')}`);
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise((resolve, reject) => {
        let proc = cp.spawn('az', args, {shell: true, env: env});
        proc.stdout.on('data', (data) => {
            let sdata = data.toString();
            outputChannel.appendLine('[CMD OUT] ' + sdata);
            try {
                resolve(parseJson(sdata));
            }
            catch (e) {
                reject(e);
            }
        });
        proc.stderr.on('data', (data) => {
            let sdata = data.toString();
            outputChannel.appendLine('[CMD ERR] ' + sdata);
            if (sdata.includes('To sign in, use a web browser to open the page')) {
                let authcode = sdata.split(' ')[sdata.split(' ').length - 3];
                if (deviceCodeCallback) deviceCodeCallback(authcode);
            }
            else if (sdata.includes('re-authenticate')) {
                reject('authentication_failed_reauthenticate');
            }
            else if (sdata.includes('command not found') || sdata.includes('not recognized')) {
                reject('az_cli_not_installed');
            }
        });
        proc.on('close', code => {
            if (code != 0 && code != null) {
                outputChannel.appendLine(`[CMD ERR] az failed with exit code ${code}`);
                reject(`az_failed_with_exit_code_${code}`);
            }
        });
    });
}

export function logout(configDir?: string): void {
    outputChannel.appendLine('[CMD] > az logout');
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    cp.execSync('az logout', {env: env});
}

export async function getAccount(configDir?: string): Promise<any> {
    outputChannel.appendLine('[CMD] > az account show');
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise((resolve, reject) => {
        cp.exec('az account show', {env: env}, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                console.error(`msra_intern_s_toolkit.getAccount: error - ${error.message}`);
                if (error.message.toString().includes('az login')) {
                    reject('not_logged_in');
                }
                else if (error.message.toString().includes('command not found') || error.message.toString().includes('not recognized')) {
                    reject('az_cli_not_installed');
                }
                reject('failed_to_get_account');
            }
            if (stdout) {
                outputChannel.appendLine('[CMD OUT] ' + stdout);
                try {
                    resolve(parseJson(stdout));
                }
                catch (e) {
                    reject(e);
                }
            }
            if (stderr) {
                outputChannel.appendLine('[CMD ERR] ' + stderr);
                console.error(`msra_intern_s_toolkit.getAccount: stderr - ${stderr}`);
                reject('failed_to_get_account');
            }
        });
    });
}

export async function getAccessToken(configDir?: string): Promise<string> {
    outputChannel.appendLine('[CMD] > az account get-access-token');
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise((resolve, reject) => {
        cp.exec('az account get-access-token', {env: env}, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                console.error(`msra_intern_s_toolkit.getAccessToken: error - ${error.message}`);
                reject('failed_to_get_access_token');
            }
            if (stdout) {
                outputChannel.appendLine('[CMD OUT] ' + stdout);
                try {
                    resolve(parseJson(stdout).accessToken);
                }
                catch (e) {
                    reject(e);
                }
            }
            if (stderr) {
                outputChannel.appendLine('[CMD ERR] ' + stderr);
                console.error(`msra_intern_s_toolkit.getAccessToken: stderr - ${stderr}`);
                reject('failed_to_get_access_token');
            }
        });
    });
}

export async function getSubscriptions(refresh: boolean = false, configDir?: string): Promise<Subscription[]> {
    let cmd = 'az account list' + (refresh ? ' --refresh' : '');
    outputChannel.appendLine(`[CMD] > ${cmd}`);
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise((resolve, reject) => {
        cp.exec(cmd, {env: env}, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                console.error(`msra_intern_s_toolkit.getSubscriptions: error - ${error.message}`);
                reject('failed_to_get_subscriptions');
            }
            if (stdout) {
                outputChannel.appendLine('[CMD OUT] ' + stdout);
                let subscriptions: Subscription[] = [];
                try {
                    parseJson(stdout).forEach((element: any) => {
                        subscriptions.push(new Subscription(element.id, element.name));
                    });
                    resolve(subscriptions);
                }
                catch (e) {
                    reject(e);
                }
            }
            if (stderr) {
                outputChannel.appendLine('[CMD ERR] ' + stderr);
                console.error(`msra_intern_s_toolkit.getSubscriptions: stderr - ${stderr}`);
                reject('failed_to_get_subscriptions');
            }
        });
    });
}
