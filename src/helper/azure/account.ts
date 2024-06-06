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
    let proc = cp.spawnSync('az', ['account', 'list'], {shell: true});
    let stdout = proc.stdout.toString();
    let stderr = proc.stderr.toString();
    if (stdout) {
        outputChannel.appendLine('[CMD OUT] ' + stdout);
        let subscriptions: Subscription[] = [];
        JSON.parse(stdout).forEach((element: any) => {
            subscriptions.push(new Subscription(element.id, element.name));
        });
        return subscriptions;
    }
    if (stderr) {
        outputChannel.appendLine('[CMD ERR] ' + stderr);
        console.error(`msra_intern_s_toolkit.getSubscriptions: stderr - ${stderr}`);
    }
    if (proc.error) {
        outputChannel.appendLine('[CMD ERR] ' + proc.error.message);
        console.error(`msra_intern_s_toolkit.getSubscriptions: error - ${proc.error.message}`);
    }
    throw 'failed_to_get_subscriptions';
}
