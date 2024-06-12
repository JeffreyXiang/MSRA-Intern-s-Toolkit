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

export async function getSubscriptions(): Promise<Subscription[]> {
    outputChannel.appendLine('[CMD] > az account list');
    return new Promise((resolve, reject) => {
        cp.exec('az account list', {}, (error, stdout, stderr) => {
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
