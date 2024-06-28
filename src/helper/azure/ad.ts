import * as cp from 'child_process'
import {outputChannel} from '../../extension'

export async function getSignedInUser(configDir?: string): Promise<any> {
    outputChannel.appendLine('[CMD] > az ad signed-in-user show');
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise((resolve, reject) => {
        cp.exec('az ad signed-in-user show', {env: env}, (error, stdout, stderr) => {
            if (stdout) {
                outputChannel.appendLine('[CMD OUT] ' + stdout);
                resolve(JSON.parse(stdout));
            }
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                console.error(`msra_intern_s_toolkit.getSignedInUser: error - ${error.message}`);
                reject('failed_to_get_signed_in_user');
            }
            if (stderr) {
                outputChannel.appendLine('[CMD ERR] ' + stderr);
                console.error(`msra_intern_s_toolkit.getSignedInUser: stderr - ${stderr}`);
                reject('failed_to_get_signed_in_user');
            }
        });
    });
}
