import * as cp from 'child_process'
import {outputChannel} from '../../../extension'

export async function tunnel(
    name: string,
    targetResourceID: string,
    resourcePort: number,
    port: number,
    subscription: string,
    resourceGroup: string,
) {
    outputChannel.appendLine(`[CMD] > az network bastion tunnel --name ${name} --target-resource-id ${targetResourceID} --resource-port ${resourcePort} --port ${port} --subscription ${subscription} --resource-group ${resourceGroup}`);
    return new Promise<void>((resolve, reject) => {
        let proc = cp.spawn('az', ['network', 'bastion', 'tunnel', '--name', name, '--target-resource-id', targetResourceID, '--resource-port', resourcePort.toString(), '--port', port.toString(), '--subscription', subscription, '--resource-group', resourceGroup], {shell: true});
        proc.stdout.on('data', (data) => {
            outputChannel.appendLine('[CMD OUT] ' + data);
        });
        proc.stderr.on('data', (data) => {
            let sdata = data.toString();
            outputChannel.appendLine('[CMD ERR] ' + sdata);
            if (sdata.includes(`'bastion' is misspelled or not recognized by the system.`)) {
                proc.kill();
                reject('azure_bastion_ext_not_installed');
            }
            else if (sdata.includes('Tunnel is ready')) {
                proc.kill();
                resolve();
            }
        });
        proc.on('error', (error) => {
            outputChannel.appendLine('[CMD ERR] ' + error.message);
            reject('failed_to_create_tunnel');
        });
    });
}