import * as cp from 'child_process'
import {outputChannel} from '../../extension'

export class Subscription {
    id: string;
    name: string;
    
    constructor(id: string, name: string) {
        this.id = id;
        this.name = name;
    }
}

export async function getAccessToken(): Promise<string> {
    outputChannel.appendLine('[CMD] > az account get-access-token');
    return new Promise((resolve, reject) => {
        cp.exec('az account get-access-token', {}, (error, stdout, stderr) => {
            if (stdout) {
                outputChannel.appendLine('[CMD OUT] ' + stdout);
                resolve(JSON.parse(stdout).accessToken);
            }
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                console.error(`msra_intern_s_toolkit.getAccessToken: error - ${error.message}`);
                reject('failed_to_get_access_token');
            }
            if (stderr) {
                outputChannel.appendLine('[CMD ERR] ' + stderr);
                console.error(`msra_intern_s_toolkit.getAccessToken: stderr - ${stderr}`);
                reject('failed_to_get_access_token');
            }
        });
    });
}

export async function getSubscriptions(refresh: boolean = false): Promise<Subscription[]> {
    let cmd = 'az account list' + (refresh ? ' --refresh' : '');
    outputChannel.appendLine(`[CMD] > ${cmd}`);
    return new Promise((resolve, reject) => {
        cp.exec(cmd, {}, (error, stdout, stderr) => {
            if (stdout) {
                outputChannel.appendLine('[CMD OUT] ' + stdout);
                let subscriptions: Subscription[] = [];
                JSON.parse(stdout).forEach((element: any) => {
                    subscriptions.push(new Subscription(element.id, element.name));
                });
                resolve(subscriptions);
            }
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                console.error(`msra_intern_s_toolkit.getSubscriptions: error - ${error.message}`);
                reject('failed_to_get_subscriptions');
            }
            if (stderr) {
                outputChannel.appendLine('[CMD ERR] ' + stderr);
                console.error(`msra_intern_s_toolkit.getSubscriptions: stderr - ${stderr}`);
                reject('failed_to_get_subscriptions');
            }
        });
    });
}
